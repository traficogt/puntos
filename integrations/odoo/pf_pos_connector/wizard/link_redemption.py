import re
from decimal import Decimal
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from ..core import encode_payload, validated_mapping, valid_uuid, reward_quantity


class PfPosLinkWizard(models.TransientModel):
    _name = 'pf.pos.link.wizard'
    _description = 'Link a completed POS line to a PF redemption'

    order_id = fields.Many2one('pos.order', required=True)
    line_id = fields.Many2one('pos.order.line', required=True)
    code = fields.Char(required=True)
    verified_snapshot = fields.Json(readonly=True)
    reward_name = fields.Char(readonly=True)
    expected_product = fields.Char(readonly=True)
    expected_quantity = fields.Float(readonly=True, digits=(16, 6))

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.user.has_group('point_of_sale.group_pos_manager'):
            raise AccessError(_('Only POS managers can link PF redemptions.'))
        if any(set(vals) - {'order_id', 'line_id', 'code'} for vals in vals_list):
            raise AccessError(_('Verification data is populated by PF lookup only.'))
        # RPC context also supplies defaults; verification must originate here.
        return super().create([{**vals, 'verified_snapshot': False, 'reward_name': False,
                                'expected_product': False, 'expected_quantity': 0} for vals in vals_list])

    def write(self, vals):
        if set(vals) - {'order_id', 'line_id', 'code'}:
            raise AccessError(_('Verification data is populated by PF lookup only.'))
        return super().write({**vals, 'verified_snapshot': False, 'reward_name': False,
                              'expected_product': False, 'expected_quantity': 0})

    def _connection(self):
        self.ensure_one()
        if not self.env.user.has_group('point_of_sale.group_pos_manager'):
            raise AccessError(_('Only POS managers can link PF redemptions.'))
        self.check_access('write')
        self.order_id.check_access('read')
        self.line_id.check_access('read')
        order = self.order_id
        if order.company_id not in self.env.companies or self.line_id.order_id != order or order.state not in ('paid', 'done', 'invoiced'):
            raise UserError(_('Select a line from a completed POS order in your company.'))
        connection = self.env['pf.pos.connector'].sudo().search([('pos_config_id', '=', order.config_id.id)], limit=1)
        if not connection or not connection.enabled or not connection.mappings_refreshed_at or connection.company_id != order.company_id:
            raise UserError(_('Activate the connection and refresh reward mappings before linking.'))
        if connection.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid') or order.currency_id.name != connection.expected_currency or order.currency_id.decimal_places != 2:
            raise UserError(_('Connection identity or currency requires administrator review.'))
        return connection

    def _validate_snapshot(self, connection, body):
        if not isinstance(body, dict) or body.get('ok') is not True:
            raise ValueError('lookup_response')
        raw_mapping = body.get('mapping')
        raw_redemption = body.get('redemption')
        if isinstance(raw_mapping, dict) and isinstance(raw_redemption, dict):
            raw_mapping = {**raw_mapping, 'reward_name': raw_redemption.get('reward_name', raw_mapping.get('reward_name'))}
        mapping = validated_mapping(raw_mapping, connection.source, connection.pf_branch_id or None)
        if mapping.get('enabled') is False:
            raise ValueError('mapping_disabled')
        redemption = body.get('redemption')
        if not isinstance(redemption, dict) or not valid_uuid(redemption.get('id')) or redemption.get('code') != self.code.strip().upper() or redemption.get('reward_id') != mapping['reward_id'] or redemption.get('branch_id') != mapping['branch_id'] or redemption.get('currency') != connection.expected_currency or redemption.get('status') != 'REDEEMED':
            raise ValueError('redemption_invalid')
        existing = body.get('fulfillment')
        if existing and (not isinstance(existing, dict) or existing.get('source') != connection.source or existing.get('orderId') != 'pos.order:%s' % self.order_id.id or existing.get('lineId') != 'pos.order.line:%s' % self.line_id.id or existing.get('eventId') != 'pos.order.line:%s:recorded' % self.line_id.id):
            raise ValueError('already_linked')
        line, order = self.line_id, self.order_id
        if line.product_id.company_id and line.product_id.company_id != order.company_id or line.product_id.type not in ('consu', 'service'):
            raise ValueError('product_invalid')
        if mapping['product_ref'] != 'product.product:%s' % line.product_id.id or mapping['item_kind'] != ('service' if line.product_id.type == 'service' else 'product') or Decimal(str(mapping['quantity'])) != Decimal(str(reward_quantity(line.qty))) or not order.currency_id.is_zero(line.price_subtotal) or not order.currency_id.is_zero(line.price_subtotal_incl) or line.refunded_orderline_id:
            raise ValueError('line_mismatch')
        if self.env['pos.order.line'].sudo().search_count([('refunded_orderline_id', '=', line.id), ('qty', '<', 0), ('order_id.state', 'in', ['paid', 'done', 'invoiced'])]):
            raise ValueError('already_returned')
        receipt = self.env['pf.pos.outbox'].sudo().search([('order_id', '=', order.id)], limit=1)
        if receipt.payload and line.id not in (receipt.excluded_reward_line_ids or []):
            raise UserError(_('This sale was captured before the reward mapping excluded its free line. Review the previously captured points in PF; the immutable sale cannot be rewritten.'))
        return mapping, redemption

    def action_lookup(self):
        connection = self._connection()
        code = self.code.strip().upper()
        if not re.fullmatch(r'(?:[0-9A-F]{8}|[0-9A-F]{16})', code):
            raise UserError(_('Enter the eight or sixteen character PF redemption reference.'))
        try:
            status, body = connection._reward_request('lookup', encode_payload({'source': connection.source, 'code': code}))
            if status != 200:
                raise ValueError('lookup_rejected')
            mapping, redemption = self._validate_snapshot(connection, body)
        except (requests.RequestException, TransportError, ValueError):
            raise UserError(_('PF could not verify this completed line. Check the code, branch, currency, exact product and quantity, complimentary price, and any previous link or return.')) from None
        # Retain only the explicit contract; never store arbitrary response data.
        fulfillment = body.get('fulfillment')
        snapshot = {'ok': True, 'mapping': mapping, 'redemption': {key: redemption[key] for key in ('id', 'code', 'reward_id', 'branch_id', 'currency', 'status')},
                    'fulfillment': {key: fulfillment.get(key) for key in ('eventId', 'source', 'orderId', 'lineId', 'status', 'stockStatus')} if fulfillment else None}
        super().write({'verified_snapshot': snapshot, 'reward_name': mapping['reward_name'],
                       'expected_product': self.line_id.product_id.display_name, 'expected_quantity': mapping['quantity']})
        return {'type': 'ir.actions.act_window', 'res_model': self._name, 'res_id': self.id, 'view_mode': 'form', 'target': 'new'}

    def action_record(self):
        connection = self._connection()
        if not self.verified_snapshot:
            raise UserError(_('Look up the PF redemption before recording the link.'))
        self.env.cr.execute('SELECT id FROM pos_order WHERE id=%s FOR NO KEY UPDATE', [self.order_id.id])
        self.env.cr.execute('SELECT id FROM pos_order_line WHERE id=%s FOR UPDATE', [self.line_id.id])
        self.line_id.invalidate_recordset()
        self.order_id.invalidate_recordset()
        connection = self._connection()
        try:
            mapping, redemption = self._validate_snapshot(connection, self.verified_snapshot)
        except ValueError:
            raise UserError(_('The verified line changed or was returned. Look up the redemption again.')) from None
        links = self.env['pf.pos.reward.fulfillment'].sudo()
        # The advisory lock also serializes different lines competing for one code.
        self.env.cr.execute('SELECT pg_advisory_xact_lock(hashtext(%s),hashtext(%s))', ['pf_redemption', redemption['id']])
        existing = links.search(['|', ('redemption_id', '=', redemption['id']), ('order_line_id', '=', self.line_id.id)])
        if existing:
            if len(existing) != 1 or existing.redemption_id != redemption['id'] or existing.order_line_id != self.line_id:
                raise UserError(_('This redemption or POS line already has a different link.'))
            return self._open_link(existing)
        cached = self.env['pf.pos.reward.mapping'].sudo().search([('connector_id', '=', connection.id), ('pf_mapping_id', '=', mapping['id']), ('version', '=', mapping['version']), ('enabled', '=', True)], limit=1)
        if not cached or {k: v for k, v in cached.snapshot.items() if k not in ('enabled', 'reward_name')} != {k: v for k, v in mapping.items() if k not in ('enabled', 'reward_name')}:
            raise UserError(_('Refresh the administrator mapping cache before recording this link.'))
        link = links.create(dict(connector_id=connection.id, order_line_id=self.line_id.id,
                                 redemption_id=redemption['id'], redemption_code=redemption['code'], reward_name=mapping['reward_name'],
                                 mapping_snapshot=mapping, currency=redemption['currency'], source=connection.source,
                                 quantity=mapping['quantity'], linked_by_id=self.env.uid))
        link._queue_recorded()
        return self._open_link(link)

    def _open_link(self, link):
        return {'type': 'ir.actions.act_window', 'res_model': 'pf.pos.reward.fulfillment', 'res_id': link.id, 'view_mode': 'form', 'target': 'current'}
