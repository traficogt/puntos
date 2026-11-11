from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class PfPosRewardMapping(models.Model):
    _name = 'pf.pos.reward.mapping'
    _description = 'PF reward mapping cache'
    _rec_name = 'reward_name'

    connector_id = fields.Many2one('pf.pos.connector', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one(related='connector_id.company_id', store=True)
    pf_mapping_id = fields.Char(required=True, index=True)
    version = fields.Integer(required=True)
    reward_name = fields.Char(required=True)
    product_id = fields.Many2one('product.product', required=True, ondelete='restrict')
    quantity = fields.Float(required=True, digits=(16, 6))
    item_kind = fields.Selection([('product', 'Product'), ('service', 'Service')], required=True)
    enabled = fields.Boolean(default=False)
    snapshot = fields.Json(required=True)

    _sql_constraints = [('version_unique', 'unique(connector_id,pf_mapping_id,version)', 'The mapping version is already cached.')]

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            raise AccessError(_('Refresh mappings from the connection.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su or set(vals) - {'enabled'}:
            raise AccessError(_('Mapping versions are immutable. Refresh from PF.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(_('Mapping history is retained.'))

    @api.model
    def _refresh(self, connector, snapshots):
        # Validate the full response before changing the active cache.
        prepared = []
        for snapshot in snapshots:
            product = self.env['product.product'].browse(int(snapshot['product_ref'].split(':')[1])).exists()
            if not product or product.company_id and product.company_id != connector.company_id or snapshot['enabled'] and (not product.active or not product.available_in_pos) or product.type not in ('consu', 'service'):
                raise ValueError('mapped_product_invalid')
            if snapshot['item_kind'] != ('service' if product.type == 'service' else 'product'):
                raise ValueError('mapped_product_invalid')
            existing = self.search([('connector_id', '=', connector.id), ('pf_mapping_id', '=', snapshot['id']), ('version', '=', snapshot['version'])])
            if existing and {k: v for k, v in existing.snapshot.items() if k not in ('enabled', 'reward_name')} != {k: v for k, v in snapshot.items() if k not in ('enabled', 'reward_name')}:
                raise ValueError('mapping_version_changed')
            prepared.append((snapshot, product, existing))
        self.search([('connector_id', '=', connector.id), ('enabled', '=', True)]).write({'enabled': False})
        for snapshot, product, existing in prepared:
            if existing:
                existing.write({'enabled': snapshot['enabled']})
            else:
                self.create(dict(connector_id=connector.id, pf_mapping_id=snapshot['id'], version=snapshot['version'],
                                 reward_name=snapshot['reward_name'], product_id=product.id, quantity=snapshot['quantity'],
                                 item_kind=snapshot['item_kind'], enabled=snapshot['enabled'], snapshot=snapshot))
