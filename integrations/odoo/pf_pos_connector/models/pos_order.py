from odoo import models, _
from odoo.exceptions import AccessError, UserError


class PosOrder(models.Model):
    _inherit = 'pos.order'

    def action_pos_order_paid(self):
        result = super().action_pos_order_paid()
        # Same transaction as payment persistence; never performs network I/O.
        self.env['pf.pos.outbox'].sudo()._capture_order(self)
        return result

    def _process_saved_order(self, draft):
        result = super()._process_saved_order(draft)
        if not draft:
            self.env['pf.pos.reward.fulfillment'].sudo()._capture_returns(self)
        return result

    def action_pf_link_redemption(self):
        self.ensure_one()
        if not self.env.user.has_group('point_of_sale.group_pos_manager'):
            raise AccessError(_('Only a POS manager can link PF redemption evidence.'))
        self.check_access('read')
        if self.state not in ('paid', 'done', 'invoiced'):
            raise UserError(_('Complete the POS order before linking PF evidence.'))
        return {'type': 'ir.actions.act_window', 'name': _('Link PF redemption'), 'res_model': 'pf.pos.link.wizard',
                'view_mode': 'form', 'target': 'new', 'context': {'default_order_id': self.id}}
