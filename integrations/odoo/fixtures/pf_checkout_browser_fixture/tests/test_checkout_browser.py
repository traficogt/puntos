import json
import os
import time
from pathlib import Path
from unittest.mock import patch
from odoo import Command
from odoo.tests import tagged
from odoo.addons.point_of_sale.tests.test_frontend import TestPointOfSaleHttpCommon


@tagged('post_install', '-at_install')
class TestPfCheckoutBrowser(TestPointOfSaleHttpCommon):
    def test_actual_owl_checkout(self):
        directory = Path(os.environ['PF_BROWSER_FIXTURE_DIR'])
        config = self.main_pos_config
        config.iface_print_auto = False
        product = self.env['product.product'].create(dict(name='PF Browser Coffee', available_in_pos=True,
            type='consu', is_storable=True, list_price=10, taxes_id=[Command.clear()]))
        config.open_ui()
        session = config.current_session_id
        session.set_opening_control(0, 'Browser fixture')
        session.update_stock_at_closing = False
        self.env['stock.quant']._update_available_quantity(product, config.picking_type_id.default_location_src_id, 10)
        connection = self.env['pf.pos.connector'].create(dict(name='Browser fixture', pos_config_id=config.id,
            base_url='https://pf-fixture.example', business_slug='fixture', expected_currency=config.currency_id.name,
            api_secret='fixture-secret-never-real'))
        connection.action_activate()
        mapping = dict(id='10000000-0000-4000-8000-000000000001', reward_id='10000000-0000-4000-8000-000000000002',
            version=1, source=connection.source, branch_id=None, product_ref='product.product:%s' % product.id,
            reward_name='Coffee reward', quantity=1, item_kind='product', enabled=True)
        customer = dict(id='10000000-0000-4000-8000-000000000004', name='Fixture Customer', points=100)
        requests = {}
        def remote(_connection, kind, payload):
            data = json.loads(payload)
            if kind == 'checkout_options':
                return 200, dict(ok=True, customer=customer, rewards=[dict(rewardId=mapping['reward_id'], rewardName='Coffee reward',
                    pointsCost=20, mapping=mapping, availability=dict(state='available', quantity=10, requiredQuantity=1, observedAt=None, source=connection.source))])
            if kind == 'checkout_authorize':
                intent = self.env['pf.pos.checkout.intent'].sudo().search([('request_id', '=', data['requestId'])])
                self.assertTrue(intent, 'The separate prepare RPC must precede remote authorization')
                requests[data['requestId']] = requests.get(data['requestId'], 0) + 1
                if requests[data['requestId']] == 1:
                    return 503, None
                return 200, dict(ok=True, requestId=data['requestId'], status='authorized', replay=True, mapping=mapping,
                    redemption=dict(id=data['requestId'], code='ABCDEF12', points_cost=20, balance_after=80))
            if kind == 'checkout_cancel':
                return 200, dict(ok=True, requestId=data['requestId'], status='cancelled', replay=False)
            raise AssertionError('Unexpected network operation in browser fixture: %s' % kind)
        session_auth = self.authenticate('pos_user', 'pos_user')
        self.cr.flush()
        self.cr.clear()
        with patch.object(type(connection), '_reward_request', remote):
            (directory / 'ready.json').write_text(json.dumps(dict(sessionId=session_auth.sid, requestKey=self.http_request_key,
                configId=config.id, token='fixture-customer-qr-token')))
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline and not (directory / 'result.json').exists():
                time.sleep(0.2)
            self.assertTrue((directory / 'result.json').exists(), 'External Playwright runner timed out')
            result = json.loads((directory / 'result.json').read_text())
            self.assertTrue(result.get('ok'), result.get('error'))
        self.env.invalidate_all()
        links = self.env['pf.pos.reward.fulfillment'].search([('connector_id', '=', connection.id)])
        self.assertEqual(len(links), 1)
        self.assertEqual(links.order_line_id.qty, 1)
        self.assertTrue(links.checkout_request_id)
        self.assertEqual(len(links.event_ids), 1)
        self.assertEqual(self.env['pf.pos.checkout.intent'].search_count([('connector_id', '=', connection.id), ('state', '=', 'cancelled')]), 1)
