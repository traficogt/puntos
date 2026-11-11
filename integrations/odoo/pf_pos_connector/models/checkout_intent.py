"""Durable checkout state. Public RPCs live on the already scoped POS order.

Preparing an intent and sending it are deliberately separate RPCs. Odoo commits
the first request before the browser may start the remote debit request.
"""
import json
import re
from decimal import Decimal
from uuid import uuid4
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, Command, _
from odoo.exceptions import AccessError, UserError
from ..core import encode_payload, validated_mapping, valid_uuid


class PfPosCheckoutIntent(models.Model):
    _name = 'pf.pos.checkout.intent'
    _description = 'PF durable checkout intent'
    _rec_name = 'request_id'
    _order = 'id desc'

    connector_id = fields.Many2one('pf.pos.connector', required=True, ondelete='restrict')
    company_id = fields.Many2one(related='connector_id.company_id', store=True, index=True)
    order_id = fields.Many2one('pos.order', required=True, ondelete='restrict', index=True)
    partner_id = fields.Many2one('res.partner', ondelete='restrict')
    fiscal_position_id = fields.Many2one('account.fiscal.position', ondelete='restrict')
    request_id = fields.Char(required=True, index=True)
    cart_line_id = fields.Char(required=True, index=True)
    customer_id = fields.Char(required=True)
    product_id = fields.Many2one('product.product', required=True, ondelete='restrict')
    location_id = fields.Many2one('stock.location', required=True, ondelete='restrict')
    quantity = fields.Float(required=True, digits=(16, 6))
    mapping_snapshot = fields.Json(required=True, groups='base.group_system')
    tax_ids = fields.Many2many('account.tax')
    payload = fields.Text(required=True, groups='base.group_system')
    operator_id = fields.Many2one('res.users', required=True, ondelete='restrict')
    state = fields.Selection([(v, v) for v in ('pending', 'authorized', 'cancel_pending', 'cancelled', 'recorded', 'review')], default='pending', required=True, index=True)
    redemption = fields.Json(groups='base.group_system')
    cancel_payload = fields.Text(groups='base.group_system')
    fulfillment_id = fields.Many2one('pf.pos.reward.fulfillment', ondelete='restrict')

    _sql_constraints = [
        ('request_unique', 'unique(request_id)', 'This checkout request already exists.'),
        ('line_unique', 'unique(cart_line_id)', 'This checkout line already exists.'),
    ]

    @api.model_create_multi
    def create(self, values):
        if not self.env.su:
            raise AccessError(_('Use the PF checkout action.'))
        return super().create(values)

    def write(self, values):
        if not self.env.su or set(values) - {'state', 'redemption', 'cancel_payload', 'fulfillment_id'}:
            raise AccessError(_('Checkout identity is immutable.'))
        return super().write(values)

    def unlink(self):
        raise AccessError(_('Checkout evidence is retained.'))

    def _public(self):
        self.ensure_one()
        return dict(requestId=self.request_id, state=self.state, lineUuid=self.cart_line_id,
                    rewardName=self.mapping_snapshot['reward_name'], quantity=self.quantity,
                    redemptionCode=(self.redemption or {}).get('code'))

    def _line(self):
        self.ensure_one()
        return self.order_id.lines.filtered(lambda line: line.uuid == self.cart_line_id)

    def _validate_line(self):
        self.ensure_one()
        line = self._line()
        if (len(line) != 1 or line.product_id != self.product_id or line.order_id != self.order_id
                or Decimal(str(line.qty)) != Decimal(str(self.quantity)) or line.refunded_orderline_id
                or line.price_unit != 0 or line.discount != 0 or set(line.tax_ids.ids) != set(self.tax_ids.ids)
                or not self.order_id.currency_id.is_zero(line.price_subtotal)
                or not self.order_id.currency_id.is_zero(line.price_subtotal_incl)):
            raise UserError(_('The PF reward line changed. Restore the original line or cancel the PF redemption.'))
        return line

    def _check_stock(self):
        self.ensure_one()
        if self.product_id.type == 'service' or not self.product_id.is_storable:
            return
        self.env.cr.execute('SELECT pg_advisory_xact_lock(%s,%s)', [self.location_id.id, self.product_id.id])
        product = self.product_id.with_company(self.company_id).with_context(location=self.location_id.id)
        product.invalidate_recordset(['free_qty'])
        others = self.search([('id', '!=', self.id), ('company_id', '=', self.company_id.id),
            ('location_id', '=', self.location_id.id), ('product_id', '=', self.product_id.id),
            ('state', 'in', ['pending', 'authorized', 'cancel_pending', 'recorded', 'review'])])
        held = sum((Decimal(str(row.quantity)) for row in others if row.state != 'recorded' or (
            row.fulfillment_id.stock_status != 'done' and not (
                row.order_id.session_id.update_stock_at_closing and row.order_id.session_id.state == 'closed'))), Decimal(0))
        normal = sum((Decimal(str(max(line.qty, 0))) for line in self.order_id.lines
                      if line.product_id == self.product_id and line.uuid != self.cart_line_id), Decimal(0))
        if Decimal(str(product.free_qty)) < held + normal + Decimal(str(self.quantity)):
            raise UserError(_('There is not enough available stock at this POS location for the cart and pending PF rewards.'))

    def _assert_order(self, draft=True):
        self.ensure_one()
        order, connection = self.order_id, self.connector_id
        cart_id = json.loads(self.payload)['cartId']
        if (order.uuid != cart_id or order.company_id != connection.company_id or order.config_id != connection.pos_config_id
                or order.currency_id.name != connection.expected_currency or order.currency_id.decimal_places != 2
                or order.partner_id != self.partner_id or order.fiscal_position_id != self.fiscal_position_id
                or order.config_id.picking_type_id.default_location_src_id != self.location_id
                or connection.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid')):
            raise UserError(_('The checkout cart, customer, company, POS or currency changed. Review this PF redemption.'))
        if draft and order.state != 'draft':
            raise UserError(_('Only an unpaid draft can authorize or cancel a PF reward.'))

    def _request(self, kind, payload):
        self.ensure_one()
        try:
            status, body = self.connector_id._reward_request(kind, payload)
        except (requests.RequestException, TransportError, ValueError):
            return None
        return body if status == 200 and isinstance(body, dict) and body.get('ok') is True else None

    def _authorize(self):
        self.ensure_one()
        self._assert_order()
        if self.state != 'pending':
            return self._public()
        self._check_stock()
        body = self._request('checkout_authorize', self.payload)
        if not body or body.get('requestId') != self.request_id or type(body.get('replay')) is not bool:
            return self._public()
        if body.get('status') == 'cancelled' and body.get('redemption') is None and body.get('mapping') is None:
            self.write({'state': 'cancelled'})
            return self._public()
        try:
            mapping = validated_mapping({**body['mapping'], 'reward_name': self.mapping_snapshot['reward_name']},
                                        self.connector_id.source, self.connector_id.pf_branch_id or None)
            if mapping != self.mapping_snapshot:
                raise ValueError('mapping_changed')
            redemption = body['redemption']
            if (body.get('status') != 'authorized' or not valid_uuid(redemption.get('id'))
                    or not re.fullmatch(r'(?:[A-F0-9]{8}|[A-F0-9]{16})', redemption.get('code', ''))
                    or type(redemption.get('points_cost')) is not int or redemption['points_cost'] < 0
                    or type(redemption.get('balance_after')) is not int or redemption['balance_after'] < 0):
                raise ValueError('redemption_invalid')
        except (TypeError, KeyError, ValueError):
            return self._public()
        self.write({'state': 'authorized', 'redemption': {k: redemption[k] for k in ('id', 'code', 'points_cost', 'balance_after')}})
        # Creating the actual line and recording the remote acknowledgement share
        # one local transaction. A rollback leaves the previously committed intent.
        self.env['pos.order.line'].create(dict(order_id=self.order_id.id, uuid=self.cart_line_id,
            product_id=self.product_id.id, qty=self.quantity, price_unit=0, discount=0,
            price_subtotal=0, price_subtotal_incl=0, tax_ids=[Command.set(self.tax_ids.ids)],
            full_product_name=self.product_id.display_name))
        self._validate_line()
        return self._public()

    def _prepare_cancel(self, reason):
        self.ensure_one()
        self._assert_order()
        if self.state in ('cancel_pending', 'cancelled'):
            return self._public()
        if self.state not in ('pending', 'authorized'):
            raise UserError(_('This checkout requires review; it cannot be cancelled as an unpaid reward.'))
        if self.state == 'authorized':
            self._validate_line()
        data = json.loads(self.payload)
        payload = dict(source=data['source'], branchId=data['branchId'], requestId=self.request_id,
            cancelRequestId=str(uuid4()), cartId=data['cartId'], cartLineId=self.cart_line_id,
            reason=reason, orderState='draft', rewardLineRemoved=True)
        self.write({'state': 'cancel_pending', 'cancel_payload': encode_payload(payload)})
        self._line().unlink()
        return self._public()

    def _cancel(self):
        self.ensure_one()
        self._assert_order()
        if self.state == 'cancelled':
            return self._public()
        if self.state != 'cancel_pending' or not self.cancel_payload or self._line():
            raise UserError(_('Prepare the unpaid cancellation before requesting it from PF.'))
        body = self._request('checkout_cancel', self.cancel_payload)
        if body and body.get('requestId') == self.request_id and body.get('status') == 'cancelled' and type(body.get('replay')) is bool:
            self.write({'state': 'cancelled'})
        return self._public()

    def _capture_paid(self):
        for intent in self:
            if intent.state == 'recorded':
                continue
            intent._assert_order(draft=False)
            line = intent._validate_line()
            if intent.state != 'authorized' or intent.order_id.state not in ('paid', 'done', 'invoiced'):
                raise UserError(_('The PF checkout has not been authorized and paid.'))
            redemption = intent.redemption
            link = self.env['pf.pos.reward.fulfillment'].create(dict(connector_id=intent.connector_id.id,
                order_line_id=line.id, redemption_id=redemption['id'], redemption_code=redemption['code'],
                reward_name=intent.mapping_snapshot['reward_name'], mapping_snapshot=intent.mapping_snapshot,
                currency=intent.order_id.currency_id.name, source=intent.connector_id.source,
                quantity=intent.quantity, linked_by_id=intent.operator_id.id,
                checkout_request_id=intent.request_id, cart_id=json.loads(intent.payload)['cartId'], cart_line_id=intent.cart_line_id))
            intent.write({'state': 'recorded', 'fulfillment_id': link.id})
            link._queue_recorded()
