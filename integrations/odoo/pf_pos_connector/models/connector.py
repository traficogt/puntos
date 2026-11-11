import json
import requests
from urllib3.exceptions import HTTPError as TransportError
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from ..core import endpoint, encode_payload, signature, valid_uuid, validated_mapping


class PfPosConnector(models.Model):
    _name = 'pf.pos.connector'
    _description = 'Puntos Fieles POS connection'
    _check_company_auto = True

    name = fields.Char(required=True)
    pos_config_id = fields.Many2one('pos.config', required=True, ondelete='restrict', check_company=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    base_url = fields.Char(required=True, help='Authorized PF HTTPS origin, without a path. No request is sent when saving.')
    business_slug = fields.Char(required=True)
    expected_currency = fields.Char(required=True, default='GTQ', help='Exact PF merchant settlement currency. No FX conversion.')
    api_secret = fields.Char(groups='base.group_system', copy=False, help='PF key. Stored in the Odoo database; protect backups. Never sent to POS clients.')
    enabled = fields.Boolean(default=False, readonly=True, copy=False)
    activated_at = fields.Datetime(readonly=True, copy=False)
    database_uuid = fields.Char(required=True, readonly=True, copy=False, default=lambda self: self.env['ir.config_parameter'].sudo().get_param('database.uuid'))
    source = fields.Char(compute='_compute_source')
    outbox_count = fields.Integer(compute='_compute_count')
    pf_branch_id = fields.Char(help='Exact PF branch UUID, or empty for unassigned. Frozen after the first mapping refresh.')
    mappings_refreshed_at = fields.Datetime(readonly=True, copy=False)
    reward_mapping_ids = fields.One2many('pf.pos.reward.mapping', 'connector_id')

    _sql_constraints = [('pos_unique', 'unique(pos_config_id)', 'One PF connection per point of sale.')]

    @api.depends('database_uuid', 'company_id', 'pos_config_id')
    def _compute_source(self):
        for row in self:
            row.source = 'odoo:%s:%s:%s' % (row.database_uuid, row.company_id.id, row.pos_config_id.id)

    def _compute_count(self):
        for row in self:
            row.outbox_count = self.env['pf.pos.outbox'].search_count([('connector_id', '=', row.id)])

    @api.constrains('base_url', 'business_slug', 'expected_currency', 'pos_config_id')
    def _check_settings(self):
        for row in self:
            try:
                endpoint(row.base_url, row.business_slug, 'sale')
            except ValueError as exc:
                raise ValidationError(_('Use an authorized public HTTPS PF origin and valid business slug.')) from exc
            if row.expected_currency != row.pos_config_id.currency_id.name or row.pos_config_id.currency_id.decimal_places != 2:
                raise ValidationError(_('PF expected currency must match the POS currency, with two decimal places. No currency conversion is performed.'))

    @api.constrains('api_secret', 'enabled')
    def _check_active_secret(self):
        for row in self:
            if row.enabled and (not row.api_secret or not 16 <= len(row.api_secret) <= 4096):
                raise ValidationError(_('An active connection requires a valid PF key. Pause before clearing it.'))

    def _require_admin(self):
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_('Only an Odoo administrator can manage PF delivery.'))
        self.check_access('write')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('enabled') or vals.get('activated_at') or vals.get('database_uuid'):
                raise UserError(_('Create the connection paused; use Activate after reviewing the pilot.'))
        return super().create(vals_list)

    def write(self, vals):
        if 'mappings_refreshed_at' in vals:
            raise UserError(_('Refresh mappings using the action.'))
        if 'pf_branch_id' in vals and (any(row.mappings_refreshed_at for row in self)
                or self.env['pf.pos.checkout.intent'].sudo().search_count([('connector_id', 'in', self.ids)])):
            raise UserError(_('The PF branch is frozen after the first mapping refresh or checkout.'))
        if {'database_uuid', 'activated_at', 'enabled'} & vals.keys():
            raise UserError(_('Use the Activate or Pause actions. Installation identity is immutable.'))
        immutable = {'pos_config_id', 'company_id', 'base_url', 'business_slug', 'expected_currency'}
        if immutable & vals.keys() and any(row.activated_at for row in self):
            raise UserError(_('Destination, currency and installation identity are frozen after activation. Pause and review the existing queue with your installer.'))
        return super().write(vals)

    def unlink(self):
        if any(row.activated_at for row in self):
            raise UserError(_('An activated PF connection is retained for receipt identity. Pause it instead.'))
        return super().unlink()

    def action_activate(self):
        self._require_admin()
        self._check_settings()
        for row in self:
            if not row.api_secret or len(row.api_secret) < 16 or len(row.api_secret) > 4096:
                raise UserError(_('Configure the PF key before activation.'))
            if row.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid'):
                raise UserError(_('This database has a different identity. Review the restored or cloned installation before enabling delivery.'))
            super(PfPosConnector, row).write({'enabled': True, 'activated_at': row.activated_at or fields.Datetime.now()})
        self.env.ref('pf_pos_connector.cron_send_outbox').sudo().write({'active': True})
        self.env.ref('pf_pos_connector.cron_send_reward_events').sudo().write({'active': True})
        self.env.ref('pf_pos_connector.cron_publish_catalog').sudo().write({'active': True})
        return True

    def action_pause(self):
        self._require_admin()
        super().write({'enabled': False})
        return True

    def action_open_outbox(self):
        self.ensure_one()
        return {'type': 'ir.actions.act_window', 'name': _('PF delivery queue'), 'res_model': 'pf.pos.outbox', 'view_mode': 'list,form', 'domain': [('connector_id', '=', self.id)]}

    @api.constrains('pf_branch_id')
    def _check_pf_branch(self):
        for row in self:
            if row.pf_branch_id and not valid_uuid(row.pf_branch_id):
                raise ValidationError(_('The PF branch must be a UUID or empty.'))

    def _reward_request(self, kind, payload):
        """Server-only signed transport; callers authorize scope before sudo."""
        self.ensure_one()
        if kind not in ('lookup', 'events', 'mappings', 'checkout_options', 'checkout_authorize', 'checkout_status', 'checkout_cancel', 'catalog_sync', 'inventory_snapshot'):
            raise ValueError('destination_invalid')
        if self.database_uuid != self.env['ir.config_parameter'].sudo().get_param('database.uuid'):
            raise ValueError('database_identity_changed')
        if not self.api_secret or not 16 <= len(self.api_secret) <= 4096:
            raise ValueError('configuration_invalid')
        if kind not in ('mappings', 'checkout_status', 'checkout_cancel', 'checkout_authorize') and not self.enabled:
            raise ValueError('connection_paused')
        with requests.Session() as session:
            session.trust_env = False
            with session.post(endpoint(self.base_url, self.business_slug, kind), data=payload.encode('utf-8'),
                              headers={'Content-Type': 'application/json', 'x-signature': signature(self.api_secret, payload)},
                              timeout=(3, 7), allow_redirects=False, stream=True) as response:
                raw = response.raw.read(65537, decode_content=True)
                if len(raw) > 65536:
                    return response.status_code, None
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    body = None
                return response.status_code, body

    def action_refresh_mappings(self):
        self._require_admin()
        self.ensure_one()
        try:
            status, body = self._reward_request('mappings', encode_payload({'source': self.source}))
            if status != 200 or not isinstance(body, dict) or body.get('ok') is not True or body.get('currency') != self.expected_currency or not isinstance(body.get('mappings'), list) or len(body['mappings']) > 500:
                raise ValueError('mapping_response')
            snapshots = [validated_mapping(item, self.source, self.pf_branch_id or None) for item in body['mappings']]
            if any('enabled' not in item for item in snapshots) or len({item['id'] for item in snapshots}) != len(snapshots):
                raise ValueError('mapping_response')
            self.env['pf.pos.reward.mapping'].sudo()._refresh(self, snapshots)
        except (requests.RequestException, TransportError, ValueError):
            raise UserError(_('PF mapping refresh failed. Check the connection, currency, exact branch, products and mapping settings. No cache was replaced.')) from None
        super().write({'mappings_refreshed_at': fields.Datetime.now()})
        if self.enabled:
            self.env.ref('pf_pos_connector.cron_send_reward_events').sudo().write({'active': True})
        return True
