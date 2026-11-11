import json
from uuid import uuid4
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from ..core import encode_payload, valid_uuid, validated_mapping


class PfCheckoutOrder(models.Model):
    _inherit = 'pos.order'

    pf_checkout_summary = fields.Json(compute='_compute_pf_checkout_summary')

    def _compute_pf_checkout_summary(self):
        for order in self:
            order.pf_checkout_summary = [row._public() for row in order._pf_intents()] if order.id else []

    def _pf_intents(self):
        return self.env['pf.pos.checkout.intent'].sudo().search([('order_id', 'in', self.ids)])

    def _pf_connection(self, draft=False, active=False):
        self.ensure_one()
        if not self.env.user.has_group('point_of_sale.group_pos_user'):
            raise AccessError(_('Only POS users can operate PF checkout.'))
        self.check_access('write' if draft else 'read')
        if self.company_id not in self.env.companies:
            raise AccessError(_('This order is outside your companies.'))
        self.session_id.check_access('read')
        self.config_id.check_access('read')
        if draft and (self.state != 'draft' or self.session_id.state != 'opened'):
            raise UserError(_('Use an unpaid order in an open POS session.'))
        connection = self.env['pf.pos.connector'].sudo().search([('pos_config_id', '=', self.config_id.id)], limit=1)
        if (not connection or connection.company_id != self.company_id or active and not connection.enabled
                or self.currency_id.name != connection.expected_currency or self.currency_id.decimal_places != 2
                or connection.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid')):
            raise UserError(_('The PF connection, company or currency is unavailable.'))
        return connection

    def _pf_lock(self):
        self.ensure_one()
        self.env.cr.execute('SELECT id FROM pos_order WHERE id=%s FOR UPDATE', [self.id])
        self.invalidate_recordset()

    def _pf_intent(self, request_id):
        if not valid_uuid(request_id):
            raise UserError(_('Invalid PF checkout reference.'))
        intent = self._pf_intents().filtered(lambda row: row.request_id == request_id)
        if len(intent) != 1:
            raise UserError(_('This checkout reference does not belong to this order.'))
        return intent

    def pf_checkout_status(self):
        self._pf_connection()
        return dict(orderState=self.state, intents=[row._public() for row in self._pf_intents()])

    def pf_checkout_options(self, token):
        connection = self._pf_connection(draft=True, active=True)
        if not isinstance(token, str) or not 20 <= len(token) <= 4096:
            raise UserError(_('Scan the customer’s PF QR card.'))
        try:
            status, body = connection._reward_request('checkout_options', encode_payload(dict(
                source=connection.source, branchId=connection.pf_branch_id or None, customerQrToken=token)))
            if (status != 200 or not isinstance(body, dict) or body.get('ok') is not True
                    or not isinstance(body.get('customer'), dict) or not valid_uuid(body['customer'].get('id'))
                    or not isinstance(body.get('rewards'), list) or len(body['rewards']) > 500):
                raise ValueError('options_invalid')
            rewards = []
            for reward in body['rewards']:
                mapping = validated_mapping({**reward['mapping'], 'reward_name': reward['rewardName']}, connection.source, connection.pf_branch_id or None)
                if reward['rewardId'] != mapping['reward_id'] or not isinstance(reward.get('availability'), dict):
                    raise ValueError('reward_invalid')
                rewards.append(dict(rewardId=mapping['reward_id'], rewardName=mapping['reward_name'],
                    pointsCost=reward['pointsCost'], mapping=mapping, availability=reward['availability']))
            return dict(ok=True, customer={key: body['customer'].get(key) for key in ('id', 'name', 'points')}, rewards=rewards)
        except (KeyError, TypeError, ValueError):
            raise UserError(_('PF could not verify this QR card and its rewards. Retry when connected.')) from None

    def pf_checkout_prepare(self, selection):
        self._pf_lock()
        connection = self._pf_connection(draft=True, active=True)
        if not isinstance(selection, dict) or set(selection) != {'requestId', 'customerId', 'customerQrToken', 'rewardId', 'mappingId', 'mappingVersion'}:
            raise UserError(_('Select a PF customer and reward first.'))
        if any(not valid_uuid(selection[key]) for key in ('requestId', 'customerId', 'rewardId', 'mappingId')) or type(selection['mappingVersion']) is not int:
            raise UserError(_('Invalid PF checkout identity.'))
        existing = self._pf_intents().filtered(lambda row: row.request_id == selection['requestId'])
        if existing:
            data = json.loads(existing.payload)
            if any(data[key] != selection[key] for key in selection):
                raise UserError(_('This checkout reference already has different details.'))
            return existing._public()
        if self._pf_intents().filtered(lambda row: row.state != 'cancelled'):
            raise UserError(_('Resolve the existing PF reward on this order before selecting another.'))
        options = self.pf_checkout_options(selection['customerQrToken'])
        reward = next((item for item in options['rewards'] if item['rewardId'] == selection['rewardId']
            and item['mapping']['id'] == selection['mappingId'] and item['mapping']['version'] == selection['mappingVersion']), None)
        if not reward or options['customer']['id'] != selection['customerId']:
            raise UserError(_('The PF customer or reward changed. Scan the card again.'))
        mapping = reward['mapping']
        if mapping.get('enabled') is False:
            raise UserError(_('This reward is no longer enabled at this checkout.'))
        product = self.env['product.product'].sudo().browse(int(mapping['product_ref'].split(':')[1])).exists()
        if (not product or not product.active or not product.available_in_pos or product.company_id and product.company_id != self.company_id
                or product.type not in ('consu', 'service') or product.tracking != 'none'
                or product.product_tmpl_id.valid_product_template_attribute_line_ids.filtered(lambda line: line.attribute_id.create_variant == 'no_variant')
                or mapping['item_kind'] != ('service' if product.type == 'service' else 'product')):
            raise UserError(_('This reward needs an active POS product without lot, serial or additional configuration requirements.'))
        if product.uom_id.rounding and abs(round(mapping['quantity'] / product.uom_id.rounding) * product.uom_id.rounding - mapping['quantity']) > 0.000001:
            raise UserError(_('The reward quantity does not match the product unit of measure.'))
        taxes = product.taxes_id.filtered(lambda tax: tax.company_id == self.company_id)
        if self.fiscal_position_id:
            taxes = self.fiscal_position_id.map_tax(taxes)
        totals = taxes.compute_all(0, self.currency_id, mapping['quantity'], product, self.partner_id)
        if not self.currency_id.is_zero(totals['total_excluded']) or not self.currency_id.is_zero(totals['total_included']):
            raise UserError(_('This product’s taxes do not allow a zero-total reward line. Review the product configuration.'))
        line_uuid = str(uuid4())
        payload = dict(selection, source=connection.source, branchId=connection.pf_branch_id or None,
                       cartId=self.uuid, cartLineId=line_uuid, operatorRef='res.users:%s' % self.env.uid)
        intent = self.env['pf.pos.checkout.intent'].sudo().create(dict(connector_id=connection.id, order_id=self.id,
            partner_id=self.partner_id.id, fiscal_position_id=self.fiscal_position_id.id,
            request_id=selection['requestId'], cart_line_id=line_uuid,
            customer_id=selection['customerId'], product_id=product.id,
            location_id=self.config_id.picking_type_id.default_location_src_id.id, quantity=mapping['quantity'],
            mapping_snapshot=mapping, tax_ids=[(6, 0, taxes.ids)], payload=encode_payload(payload), operator_id=self.env.uid))
        intent._check_stock()
        return intent._public()

    def pf_checkout_authorize(self, request_id):
        self._pf_lock()
        self._pf_connection(draft=True)
        return self._pf_intent(request_id)._authorize()

    def pf_checkout_prepare_cancel(self, request_id, reason):
        self._pf_lock()
        self._pf_connection(draft=True)
        if not isinstance(reason, str) or not 3 <= len(reason.strip()) <= 500:
            raise UserError(_('Enter a short reason for cancelling the unpaid reward.'))
        return self._pf_intent(request_id)._prepare_cancel(reason.strip())

    def pf_checkout_cancel(self, request_id):
        self._pf_lock()
        self._pf_connection(draft=True)
        return self._pf_intent(request_id)._cancel()

    def _pf_validate_payment(self):
        for order in self:
            order._pf_lock()
            for intent in order._pf_intents().filtered(lambda row: row.state != 'cancelled'):
                intent._assert_order(draft=False)
                if intent.state not in ('authorized', 'recorded'):
                    raise UserError(_('PF confirmation is pending. Resolve or explicitly cancel the reward before payment.'))
                intent._validate_line()
                if intent.state == 'authorized' and order.state == 'draft':
                    intent._check_stock()

    def _process_saved_order(self, draft):
        if not draft:
            self._pf_validate_payment()
        result = super()._process_saved_order(draft)
        if not draft and self.state in ('paid', 'done', 'invoiced'):
            self._pf_intents().filtered(lambda row: row.state in ('authorized', 'recorded'))._capture_paid()
        return result

    def action_pos_order_cancel(self):
        if self._pf_intents().filtered(lambda row: row.state != 'cancelled'):
            raise UserError(_('Cancel and confirm the PF redemption before cancelling this order.'))
        return super().action_pos_order_cancel()

    def write(self, values):
        if set(values) & {'partner_id', 'state', 'uuid'}:
            active = self._pf_intents().filtered(lambda row: row.state != 'cancelled')
            if 'uuid' in values and any(values['uuid'] != json.loads(row.payload)['cartId'] for row in active):
                raise UserError(_('The cart identity is fixed by its PF checkout.'))
            if active and values.get('state') == 'cancel':
                raise UserError(_('Confirm the PF cancellation before cancelling this order.'))
            if 'partner_id' in values and any((row.partner_id.id or False) != (values['partner_id'] or False) for row in active):
                raise UserError(_('Cancel the PF reward before changing this order’s customer.'))
            if active and values.get('state') in ('paid', 'done', 'invoiced'):
                self._pf_validate_payment()
        return super().write(values)


class PfCheckoutLine(models.Model):
    _inherit = 'pos.order.line'

    def write(self, values):
        intents = self.env['pf.pos.checkout.intent'].sudo().search([('cart_line_id', 'in', self.mapped('uuid')),
            ('state', 'in', ['authorized', 'recorded'])])
        result = super().write(values)
        for intent in intents:
            intent._validate_line()
        return result

    def unlink(self):
        if self.env['pf.pos.checkout.intent'].sudo().search_count([('cart_line_id', 'in', self.mapped('uuid')),
                ('state', 'in', ['authorized', 'recorded', 'review'])]):
            raise UserError(_('Use Cancel PF reward before removing this line.'))
        return super().unlink()
