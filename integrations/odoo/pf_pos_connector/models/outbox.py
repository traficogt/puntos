import json
from datetime import timedelta
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from ..core import sale_payload, refund_payload, encode_payload, endpoint, signature, delivery_outcome, retry_delay


class PfPosOutbox(models.Model):
    _name = 'pf.pos.outbox'
    _description = 'Puntos Fieles durable POS delivery'
    _order = 'id desc'
    _rec_name = 'order_id'

    connector_id = fields.Many2one('pf.pos.connector', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one(related='connector_id.company_id', store=True, index=True)
    order_id = fields.Many2one('pos.order', required=True, ondelete='restrict', index=True)
    kind = fields.Selection([('sale','Sale'),('refund','Refund')], required=True)
    payload = fields.Text(readonly=True, groups='base.group_system', help='Frozen signed JSON. Contains customer phone for sales; administrators only.')
    original_snapshot = fields.Json(readonly=True, groups='base.group_system')
    excluded_reward_line_ids = fields.Json(readonly=True, groups='base.group_system')
    state = fields.Selection([('pending','Queued'),('retry','Waiting for retry'),('done','Confirmed'),('review','Review required'),('skipped','Complimentary receipt — no points')], default='pending', required=True, index=True)
    reason = fields.Char(readonly=True)
    attempts = fields.Integer(default=0, readonly=True)
    total_attempts = fields.Integer(default=0, readonly=True)
    next_attempt = fields.Datetime(default=fields.Datetime.now, index=True, readonly=True)
    last_attempt = fields.Datetime(readonly=True)
    http_status = fields.Integer(readonly=True)

    _sql_constraints = [('order_unique','unique(order_id)','This paid POS order already has a PF queue record.')]

    @api.model
    def _capture_order(self, order):
        order.ensure_one()
        if order.state not in ('paid','done','invoiced'):
            return self.browse()
        connection = self.env['pf.pos.connector'].sudo().search([('pos_config_id','=',order.config_id.id)], limit=1)
        if not connection.activated_at or order.date_order < connection.activated_at:
            return self.browse()
        existing = self.search([('order_id','=',order.id)], limit=1)
        if existing:
            return existing
        row = self.create({'connector_id':connection.id, 'order_id':order.id, 'kind':'refund' if order.amount_total < 0 else 'sale', 'state':'review', 'reason':'normalization_incomplete'})
        row._prepare_payload()
        return row

    def _prepare_payload(self):
        self.ensure_one()
        order, connection = self.order_id, self.connector_id
        try:
            if connection.company_id != order.company_id or order.currency_id.decimal_places != 2:
                raise ValueError('currency_mismatch')
            receipt = 'pos.order:%s' % order.id
            if order.currency_id.is_zero(order.amount_total):
                self.write({'state': 'skipped', 'reason': 'zero_total_no_award', 'original_snapshot': {str(line.id): line.qty for line in order.lines}})
                return
            if self.kind == 'sale':
                if order.lines.refunded_orderline_id or any(line.qty < 0 for line in order.lines):
                    raise ValueError('mixed_sale_refund')
                mapped = self.env['pf.pos.reward.mapping'].sudo().search([('connector_id', '=', connection.id), ('enabled', '=', True)]).product_id
                linked = self.env['pf.pos.reward.fulfillment'].sudo().search([('order_id', '=', order.id)]).order_line_id
                checkout_uuids = order._pf_intents().filtered(lambda intent: intent.state in ('authorized', 'recorded')).mapped('cart_line_id')
                excluded = order.lines.filtered(lambda line: line.uuid in checkout_uuids or line in linked or line.product_id in mapped and order.currency_id.is_zero(line.price_subtotal) and order.currency_id.is_zero(line.price_subtotal_incl))
                earning_lines = order.lines - excluded
                data = sale_payload(source=connection.source, receipt_id=receipt, phone=order.partner_id.mobile or order.partner_id.phone or '', amount=order.amount_total, currency=order.currency_id.name, expected_currency=connection.expected_currency, quantities=earning_lines.mapped('qty') or [0])
                snapshot = {str(line.id):line.qty for line in order.lines}
            else:
                originals = order.lines.refunded_orderline_id.order_id
                if len(originals) != 1 or any(line.qty >= 0 or not line.refunded_orderline_id for line in order.lines):
                    raise ValueError('refund_original_unverified')
                original = self.search([('order_id','=',originals.id), ('kind','=','sale')], limit=1)
                if not original.payload or original.connector_id.company_id != connection.company_id or original.connector_id.base_url != connection.base_url or original.connector_id.business_slug != connection.business_slug:
                    raise ValueError('refund_original_unverified')
                original_data = json.loads(original.payload)
                returned = {}
                for line in order.lines:
                    key = str(line.refunded_orderline_id.id)
                    returned[key] = returned.get(key, 0) + abs(line.qty)
                data = refund_payload(source=original_data['source'], receipt_id=receipt, original_id=original_data['saleId'], amount=abs(order.amount_total), original_amount=original_data['amountQ'], currency=order.currency_id.name, expected_currency=connection.expected_currency, original_lines=original.original_snapshot, returned_lines=returned)
                snapshot = False
            self.write({'payload':encode_payload(data), 'original_snapshot':snapshot, 'excluded_reward_line_ids': excluded.ids if self.kind == 'sale' else [], 'state':'pending', 'reason':False})
        except ValueError as exc:
            allowed = {'customer_phone','currency_mismatch','amount_range','amount_precision','items_range','mixed_sale_refund','refund_original_unverified'}
            reason = str(exc) if str(exc) in allowed else 'normalization_review'
            self.write({'state':'review', 'reason':reason})

    def _post(self):
        self.ensure_one()
        connection = self.connector_id
        url = endpoint(connection.base_url, connection.business_slug, self.kind)
        with requests.Session() as session:
            session.trust_env = False
            with session.post(url, data=self.payload.encode('utf-8'), headers={'Content-Type':'application/json', 'x-signature':signature(connection.api_secret, self.payload)}, timeout=(3, 7), allow_redirects=False, stream=True) as response:
                raw = response.raw.read(65537, decode_content=True)
                if len(raw) > 65536:
                    return response.status_code, None
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    body = None
                return response.status_code, body

    def _deliver(self):
        self.ensure_one()
        if not self.connector_id.enabled or not self.payload or self.state not in ('pending','retry'):
            return
        if self.connector_id.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid'):
            self.write({'state':'review','reason':'database_identity_changed'})
            return
        attempt = self.attempts + 1
        status = 0
        try:
            status, body = self._post()
            state, reason = delivery_outcome(status, body, self.kind)
        except (requests.RequestException, TransportError):
            state, reason = 'retry', 'network_error'
        except ValueError:
            state, reason = 'review', 'configuration_invalid'
        if state == 'retry' and attempt >= 10:
            state, reason = 'review', 'retry_exhausted'
        now = fields.Datetime.now()
        self.write({'state':state, 'reason':reason, 'attempts':attempt, 'total_attempts':self.total_attempts+1, 'last_attempt':now, 'http_status':status, 'next_attempt':now+timedelta(seconds=retry_delay(attempt))})

    @api.model
    def _cron_send(self):
        self.env['pf.pos.connector'].flush_model(['enabled'])
        self.flush_model(['connector_id', 'state', 'next_attempt'])
        self.env.cr.execute('''SELECT q.id FROM pf_pos_outbox q JOIN pf_pos_connector c ON c.id=q.connector_id
            WHERE c.enabled AND q.state IN ('pending','retry') AND q.next_attempt <= NOW()
            ORDER BY q.id FOR UPDATE OF q SKIP LOCKED LIMIT 5''')
        rows = self.sudo().browse([row[0] for row in self.env.cr.fetchall()])
        for row in rows:
            row._deliver()
        remaining = self.sudo().search_count([('connector_id.enabled','=',True),('state','in',['pending','retry']),('next_attempt','<=',fields.Datetime.now())])
        self.env['ir.cron']._notify_progress(done=len(rows), remaining=remaining)

    def action_retry(self):
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_('Only an Odoo administrator can retry PF delivery.'))
        self.check_access('read')
        for row in self:
            self.env.cr.execute('SELECT id FROM pf_pos_outbox WHERE id=%s FOR UPDATE', [row.id])
            row.invalidate_recordset()
            if row.state in ('done', 'skipped'):
                raise UserError(_('Confirmed receipts are immutable.'))
            if not row.payload:
                if row.total_attempts:
                    raise UserError(_('A previously attempted payload cannot be rebuilt.'))
                row.sudo()._prepare_payload()
                if not row.payload:
                    continue
            row.sudo().write({'state':'pending','attempts':0,'next_attempt':fields.Datetime.now(),'reason':'manual_retry'})
        return True
