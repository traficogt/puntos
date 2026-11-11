import json
from datetime import timedelta
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from ..core import encode_payload, reward_delivery_outcome, retry_delay


class PfPosRewardEvent(models.Model):
    _name = 'pf.pos.reward.event'
    _description = 'PF durable redemption evidence event'
    _rec_name = 'event_id'
    _order = 'id desc'

    fulfillment_id = fields.Many2one('pf.pos.reward.fulfillment', required=True, ondelete='restrict', index=True)
    connector_id = fields.Many2one(related='fulfillment_id.connector_id', store=True, index=True)
    company_id = fields.Many2one(related='fulfillment_id.company_id', store=True)
    event_id = fields.Char(required=True, index=True)
    kind = fields.Selection([('recorded', 'POS recorded'), ('reversed', 'Returned — review'), ('stock_updated', 'Inventory observation')], required=True)
    order_line_id = fields.Many2one('pos.order.line', required=True, ondelete='restrict')
    parent_event_id = fields.Many2one('pf.pos.reward.event', ondelete='restrict')
    quantity = fields.Float(required=True, digits=(16, 6))
    stock_status = fields.Char(required=True)
    payload = fields.Text(required=True, groups='base.group_system')
    state = fields.Selection([('pending', 'Queued'), ('retry', 'Waiting for retry'), ('done', 'Acknowledged'), ('review', 'Delivery needs review')], default='pending', required=True, index=True)
    reason = fields.Char(readonly=True)
    attempts = fields.Integer(default=0, readonly=True)
    total_attempts = fields.Integer(default=0, readonly=True)
    next_attempt = fields.Datetime(default=fields.Datetime.now, required=True, index=True)
    last_attempt = fields.Datetime(readonly=True)
    http_status = fields.Integer(readonly=True)
    stock_checked_at = fields.Datetime(default='2000-01-01 00:00:00', required=True, readonly=True)

    _sql_constraints = [('event_unique', 'unique(connector_id,event_id)', 'This evidence event is already queued.')]

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            raise AccessError(_('Events are created by the verified linking workflow.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su or set(vals) - {'state', 'reason', 'attempts', 'total_attempts', 'next_attempt', 'last_attempt', 'http_status', 'stock_checked_at'}:
            raise AccessError(_('Frozen evidence cannot be edited.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(_('Evidence events are retained for deduplication.'))

    @api.model
    def _enqueue(self, link, line, payload, parent=None):
        self.env.cr.execute('SELECT id FROM pf_pos_reward_fulfillment WHERE id=%s FOR UPDATE', [link.id])
        existing = self.search([('connector_id', '=', link.connector_id.id), ('event_id', '=', payload['eventId'])])
        body = encode_payload(payload)
        if existing:
            if existing.payload != body:
                raise UserError(_('Evidence identity conflicts with an existing frozen event.'))
            return existing
        return self.create(dict(fulfillment_id=link.id, event_id=payload['eventId'], kind=payload['kind'],
                                order_line_id=line.id, parent_event_id=parent.id if parent else False,
                                quantity=payload['quantity'], stock_status=payload['stockStatus'], payload=body))

    def _deliver(self):
        self.ensure_one()
        if self.state not in ('pending', 'retry') or not self.connector_id.enabled:
            return
        if self.parent_event_id and self.parent_event_id.state != 'done':
            return
        observed = self.parent_event_id if self.kind == 'stock_updated' else self
        if not self.fulfillment_id._matches_frozen_line(observed):
            self.write({'state': 'review', 'reason': 'receipt_evidence_changed'})
            self.fulfillment_id.write({'reconciliation_state': 'review', 'review_reason': 'receipt_evidence_changed'})
            return
        status, attempt = 0, self.attempts + 1
        try:
            status, body = self.connector_id._reward_request('events', self.payload)
            state, reason = reward_delivery_outcome(status, body, self.event_id, self.fulfillment_id.redemption_id)
        except (requests.RequestException, TransportError):
            state, reason = 'retry', 'network_error'
        except ValueError:
            state, reason = 'review', 'configuration_invalid'
        if state == 'retry' and attempt >= 10:
            state, reason = 'review', 'retry_exhausted'
        now = fields.Datetime.now()
        self.write(dict(state=state, reason=reason, attempts=attempt, total_attempts=self.total_attempts + 1,
                        last_attempt=now, http_status=status, next_attempt=now + timedelta(seconds=retry_delay(attempt))))
        link = self.fulfillment_id
        if state == 'review' or state == 'done' and reason == 'review':
            link.write({'reconciliation_state': 'review', 'review_reason': reason})
        elif state == 'done' and not link.event_ids.filtered(lambda event: event.kind == 'reversed' or event.state == 'review' or event.state == 'done' and event.reason == 'review') and link.review_reason not in ('returned_reward', 'return_scope_mismatch', 'returned_quantity_exceeded', 'return_quantity_invalid', 'return_price_mismatch', 'receipt_evidence_changed'):
            link.write({'reconciliation_state': 'recorded', 'review_reason': False})
        if state == 'done' and self.kind in ('recorded', 'stock_updated') and not (self.parent_event_id and self.parent_event_id.kind == 'reversed'):
            link.write({'stock_status': self.stock_status})

    @api.model
    def _capture_stock_updates(self):
        # Observation only. Session-aggregated movements remain unknown unless
        # Odoo supplies an unambiguous order picking; never mutate inventory.
        candidates = self.sudo().search([('kind', 'in', ['recorded', 'reversed']), ('stock_status', 'in', ['pending', 'unknown']), ('connector_id.enabled', '=', True)], order='stock_checked_at,id', limit=100)
        for event in candidates:
            event.write({'stock_checked_at': fields.Datetime.now()})
            if self.search_count([('parent_event_id', '=', event.id), ('kind', '=', 'stock_updated')]):
                continue
            link, line = event.fulfillment_id, event.order_line_id
            if not link._matches_frozen_line(event):
                link.write({'reconciliation_state': 'review', 'review_reason': 'receipt_evidence_changed'})
                continue
            stock = link._stock_status(line.order_id, line.product_id, link.mapping_snapshot['item_kind'], reverse=event.kind == 'reversed')
            if stock not in ('done', 'returned'):
                continue
            payload = json.loads(event.payload)
            payload.update(kind='stock_updated', eventId='stock:%s:%s' % (event.event_id, stock), originalEventId=event.event_id, stockStatus=stock)
            self.sudo()._enqueue(link, line, payload, event)

    @api.model
    def _cron_send(self):
        self._capture_stock_updates()
        self.env['pf.pos.connector'].flush_model(['enabled'])
        self.flush_model(['connector_id', 'state', 'next_attempt', 'parent_event_id'])
        self.env.cr.execute('''SELECT q.id FROM pf_pos_reward_event q JOIN pf_pos_connector c ON c.id=q.connector_id
            LEFT JOIN pf_pos_reward_event parent ON parent.id=q.parent_event_id
            WHERE c.enabled AND q.state IN ('pending','retry') AND q.next_attempt<=NOW()
            AND (q.parent_event_id IS NULL OR parent.state='done')
            ORDER BY q.id FOR NO KEY UPDATE OF q SKIP LOCKED LIMIT 5''')
        rows = self.sudo().browse([item[0] for item in self.env.cr.fetchall()])
        for row in rows:
            row._deliver()
        self.env['ir.cron']._notify_progress(done=len(rows), remaining=self.sudo().search_count([('connector_id.enabled', '=', True), ('state', 'in', ['pending', 'retry']), ('next_attempt', '<=', fields.Datetime.now()), '|', ('parent_event_id', '=', False), ('parent_event_id.state', '=', 'done')]))

    def action_retry(self):
        if not self.env.user.has_group('point_of_sale.group_pos_manager'):
            raise AccessError(_('Only a POS manager can retry reviewed evidence.'))
        self.check_access('read')
        for event in self:
            self.env.cr.execute('SELECT id FROM pf_pos_reward_event WHERE id=%s FOR NO KEY UPDATE', [event.id])
            event.invalidate_recordset()
            if event.state == 'done':
                raise UserError(_('Acknowledged events cannot be resent manually.'))
            event.sudo().write({'state': 'pending', 'attempts': 0, 'next_attempt': fields.Datetime.now(), 'reason': 'manual_retry'})
        return True
