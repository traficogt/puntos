import json
from decimal import Decimal
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from ..core import reward_quantity


class PfPosRewardFulfillment(models.Model):
    _name = 'pf.pos.reward.fulfillment'
    _description = 'PF verified POS redemption link'
    _rec_name = 'redemption_code'
    _order = 'id desc'

    connector_id = fields.Many2one('pf.pos.connector', required=True, ondelete='restrict')
    company_id = fields.Many2one(related='connector_id.company_id', store=True, index=True)
    order_line_id = fields.Many2one('pos.order.line', required=True, ondelete='restrict', index=True)
    order_id = fields.Many2one(related='order_line_id.order_id', store=True)
    redemption_id = fields.Char(required=True, index=True)
    redemption_code = fields.Char(required=True)
    reward_name = fields.Char(required=True)
    mapping_snapshot = fields.Json(required=True, groups='base.group_system')
    currency = fields.Char(required=True)
    source = fields.Char(required=True)
    quantity = fields.Float(required=True, digits=(16, 6))
    linked_by_id = fields.Many2one('res.users', required=True, ondelete='restrict')
    reconciliation_state = fields.Selection([('queued', 'Queued'), ('recorded', 'POS recorded'), ('review', 'Review required')], default='queued', required=True)
    stock_status = fields.Selection([('unknown', 'Unknown'), ('pending', 'Inventory pending'), ('done', 'Inventory completed'), ('not_applicable', 'Service — no inventory'), ('returned', 'Returned')], default='unknown', required=True)
    review_reason = fields.Char()
    event_ids = fields.One2many('pf.pos.reward.event', 'fulfillment_id')
    checkout_request_id = fields.Char(index=True)
    cart_id = fields.Char()
    cart_line_id = fields.Char()

    _sql_constraints = [
        ('redemption_unique', 'unique(redemption_id)', 'This PF redemption already has an Odoo line.'),
        ('line_unique', 'unique(order_line_id)', 'This POS line is already linked to a PF redemption.'),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            raise AccessError(_('Use Link PF redemption on a completed POS order.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su or set(vals) - {'reconciliation_state', 'stock_status', 'review_reason'}:
            raise AccessError(_('POS redemption evidence is immutable.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(_('POS redemption evidence is retained.'))

    def _matches_frozen_line(self, event):
        """Paid POS lines can still be edited through Odoo's ORM.

        Never describe a later movement using another product/quantity's frozen
        event. Preserve history and require review when the receipt changed.
        """
        self.ensure_one()
        line, data = event.order_line_id, json.loads(event.payload)
        order = line.order_id
        forward = event.kind == 'recorded'
        return (
            data['orderId'] == 'pos.order:%s' % order.id
            and data['lineId'] == 'pos.order.line:%s' % line.id
            and data['productRef'] == 'product.product:%s' % line.product_id.id
            and Decimal(str(abs(line.qty))) == Decimal(str(data['quantity']))
            and (line.qty > 0 if forward else line.qty < 0)
            and (not line.refunded_orderline_id if forward else line.refunded_orderline_id == self.order_line_id)
            and order.state in ('paid', 'done', 'invoiced')
            and order.company_id == self.company_id
            and order.currency_id.name == data['currency']
            and order.currency_id.is_zero(line.price_subtotal)
            and order.currency_id.is_zero(line.price_subtotal_incl)
        )

    @api.model
    def _stock_status(self, order, product, item_kind, reverse=False):
        if item_kind == 'service':
            return 'not_applicable'
        lines = order.lines.filtered(lambda line: line.product_id == product and (line.qty < 0 if reverse else line.qty > 0))
        expected = sum(abs(line.qty) for line in lines)
        moves = order.picking_ids.move_ids.filtered(lambda move: move.product_id == product and (
            move.location_id.usage == 'customer' if reverse else move.location_dest_id.usage == 'customer'))
        if not moves:
            return 'pending' if order.session_id.update_stock_at_closing and order.session_id.state != 'closed' else 'unknown'
        completed = sum(move.product_uom._compute_quantity(move.quantity, product.uom_id) for move in moves if move.state == 'done')
        if completed >= expected and expected > 0 and all(move.state == 'done' for move in moves):
            return 'returned' if reverse else 'done'
        return 'pending'

    def _queue_recorded(self):
        self.ensure_one()
        mapping, line = self.mapping_snapshot, self.order_line_id
        stock = self._stock_status(line.order_id, line.product_id, mapping['item_kind'])
        payload = dict(eventId='pos.order.line:%s:recorded' % line.id, redemptionId=self.redemption_id,
                       source=self.source, orderId='pos.order:%s' % line.order_id.id,
                       lineId='pos.order.line:%s' % line.id, productRef=mapping['product_ref'],
                       quantity=self.quantity, currency=self.currency, mappingId=mapping['id'], mappingVersion=mapping['version'],
                       kind='recorded', stockStatus=stock, lineTotal=0)
        if self.checkout_request_id:
            payload.update(checkoutRequestId=self.checkout_request_id, cartId=self.cart_id, cartLineId=self.cart_line_id)
        self.write({'stock_status': stock})
        return self.env['pf.pos.reward.event'].sudo()._enqueue(self, line, payload)

    @api.model
    def _capture_returns(self, order):
        if order.state not in ('paid', 'done', 'invoiced'):
            return
        for line in order.lines.filtered(lambda item: item.qty < 0 and item.refunded_orderline_id).sorted(lambda item: item.refunded_orderline_id.id):
            self.env.cr.execute('SELECT id FROM pos_order_line WHERE id=%s FOR UPDATE', [line.refunded_orderline_id.id])
            link = self.sudo().search([('order_line_id', '=', line.refunded_orderline_id.id)], limit=1)
            if not link:
                continue
            event_id = 'pos.order.line:%s:reversed' % line.id
            if link.event_ids.filtered(lambda event: event.event_id == event_id):
                continue
            recorded = link.event_ids.filtered(lambda event: event.kind == 'recorded')
            if not recorded or not link._matches_frozen_line(recorded):
                link.write({'reconciliation_state': 'review', 'review_reason': 'receipt_evidence_changed'})
                continue
            connection = self.env['pf.pos.connector'].sudo().search([('pos_config_id', '=', order.config_id.id)], limit=1)
            link.write({'reconciliation_state': 'review', 'review_reason': 'returned_reward'})
            if not connection or connection.company_id != link.company_id or connection.base_url != link.connector_id.base_url or connection.business_slug != link.connector_id.business_slug or order.currency_id.name != link.currency or 'product.product:%s' % line.product_id.id != link.mapping_snapshot['product_ref']:
                link.write({'review_reason': 'return_scope_mismatch'})
                continue
            if not order.currency_id.is_zero(line.price_subtotal) or not order.currency_id.is_zero(line.price_subtotal_incl):
                link.write({'review_reason': 'return_price_mismatch'})
                continue
            returned = sum(Decimal(str(event.quantity)) for event in link.event_ids if event.kind == 'reversed')
            try:
                quantity = Decimal(str(reward_quantity(abs(line.qty))))
            except ValueError:
                link.write({'review_reason': 'return_quantity_invalid'})
                continue
            if returned + quantity > Decimal(str(link.quantity)):
                link.write({'review_reason': 'returned_quantity_exceeded'})
                continue
            payload = json.loads(recorded.payload)
            payload.update(eventId=event_id, originalEventId=recorded.event_id, orderId='pos.order:%s' % order.id,
                           lineId='pos.order.line:%s' % line.id, quantity=float(quantity), kind='reversed',
                           stockStatus=self._stock_status(order, line.product_id, link.mapping_snapshot['item_kind'], reverse=True))
            self.env['pf.pos.reward.event'].sudo()._enqueue(link, line, payload, recorded)
