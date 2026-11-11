from datetime import datetime, timezone
import unicodedata
from uuid import uuid4
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, _
from odoo.exceptions import UserError
from ..core import encode_payload


def clean_text(value, limit):
    return ''.join(char for char in (value or '') if unicodedata.category(char) not in ('Cc', 'Cf')).strip()[:limit].strip()


class PfPosCatalog(models.Model):
    _inherit = 'pf.pos.connector'

    catalog_auto_sync = fields.Boolean(default=False, help='Publish product catalog and location-specific stock every two minutes while this connection is enabled.')
    catalog_synced_at = fields.Datetime(readonly=True)
    catalog_sync_state = fields.Selection([('never', 'Not published'), ('done', 'Published'), ('retry', 'Retry needed')], default='never', readonly=True)

    def action_publish_catalog(self):
        self._require_admin()
        for connection in self:
            try:
                connection._publish_catalog()
            except (requests.RequestException, TransportError, ValueError):
                raise UserError(_('Catalog publication could not be confirmed. Check the PF connection and branch, then retry.')) from None
        return True

    def _publish_catalog(self):
        self.ensure_one()
        if not self.enabled:
            raise ValueError('connection_paused')
        products = self.env['product.product'].sudo().with_company(self.company_id).with_context(active_test=False).search([
            ('type', 'in', ['consu', 'service']), '|', ('company_id', '=', False), ('company_id', '=', self.company_id.id)], order='id')
        # Explicit active=false updates preserve archived/removed POS variants.
        # Separate bounded upsert batches never interpret absent rows as deletion.
        location = self.pos_config_id.picking_type_id.default_location_src_id
        for offset in range(0, len(products), 200):
            batch = products[offset:offset + 200]
            items = [dict(productRef='product.product:%s' % product.id, sku=clean_text(product.default_code, 100) or None,
                name=clean_text(product.display_name, 150) or 'Product %s' % product.id,
                itemKind='service' if product.type == 'service' else 'product',
                active=bool(product.active and product.available_in_pos)) for product in batch]
            observed = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            payload = dict(source=self.source, requestId=str(uuid4()), observedAt=observed, items=items)
            status, body = self._reward_request('catalog_sync', encode_payload(payload))
            if status != 200 or not isinstance(body, dict) or body.get('ok') is not True:
                raise ValueError('catalog_rejected')
            if self.pf_branch_id:
                availability = []
                for product in batch:
                    quantity = None
                    if product.type != 'service' and product.is_storable:
                        quantity = round(max(0, product.with_context(location=location.id).free_qty), 6)
                        if quantity > 1000000000:
                            quantity = None
                    availability.append(dict(productRef='product.product:%s' % product.id, availableQuantity=quantity))
                payload = dict(source=self.source, requestId=str(uuid4()), branchId=self.pf_branch_id,
                    observedAt=datetime.now(timezone.utc).isoformat(timespec='milliseconds'), items=availability)
                status, body = self._reward_request('inventory_snapshot', encode_payload(payload))
                if status != 200 or not isinstance(body, dict) or body.get('ok') is not True:
                    raise ValueError('inventory_rejected')
        self.write({'catalog_synced_at': fields.Datetime.now(), 'catalog_sync_state': 'done'})

    @api.model
    def _cron_publish_catalog(self):
        for connection in self.sudo().search([('enabled', '=', True), ('catalog_auto_sync', '=', True)], limit=20):
            try:
                with self.env.cr.savepoint():
                    connection._publish_catalog()
            except (requests.RequestException, TransportError, ValueError):
                connection.write({'catalog_sync_state': 'retry'})
