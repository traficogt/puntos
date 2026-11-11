import json
from unittest.mock import patch
from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged, new_test_user
from odoo.addons.point_of_sale.tests.common import TestPointOfSaleCommon


@tagged('post_install', '-at_install')
class TestPfConnector(TestPointOfSaleCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner1.phone = '+50255554444'
        cls.connector = cls.env['pf.pos.connector'].create({
            'name': 'Isolated fixture', 'pos_config_id': cls.pos_config.id,
            'base_url': 'https://pf-fixture.example', 'business_slug': 'fixture',
            'expected_currency': cls.pos_config.currency_id.name, 'api_secret': 'fixture-secret-never-real',
        })
        cls.pos_config.open_ui()
        cls.session = cls.pos_config.current_session_id
        cls.session.action_pos_session_open()

    def _order(self, qty=1, refund_line=None, amount=10, partner=None):
        line = {'product_id':self.product3.id, 'qty':qty, 'price_unit':10, 'price_subtotal':amount, 'price_subtotal_incl':amount, 'tax_ids':[Command.clear()]}
        if refund_line:
            line['refunded_orderline_id'] = refund_line.id
        order = self.env['pos.order'].create({
            'session_id':self.session.id, 'partner_id':(partner or self.partner1).id,
            'amount_total':amount, 'amount_paid':amount, 'amount_tax':0, 'amount_return':0,
            'lines':[Command.create(line)],
            'payment_ids':[Command.create({'amount':amount, 'payment_method_id':self.cash_payment_method.id})],
        })
        return order

    def _capture(self, order):
        with patch('requests.Session.send', side_effect=AssertionError('Cashier transaction must not send HTTP')):
            order.action_pos_order_paid()
        return self.env['pf.pos.outbox'].search([('order_id','=',order.id)])

    def test_disabled_activation_pause_and_deduplication(self):
        self.assertFalse(self.connector.enabled)
        self.assertFalse(self._capture(self._order()))
        self.connector.action_activate()
        order = self._order()
        receipt = self._capture(order)
        self.assertEqual(receipt.state, 'pending')
        self.assertEqual(len(self._capture(order)), 1)
        self.assertEqual(json.loads(receipt.payload)['items'], 1)
        self.connector.action_pause()
        self.assertEqual(self._capture(self._order()).state, 'pending')
        with patch.object(type(receipt), '_post', side_effect=AssertionError('Paused connection must not send')):
            self.env['pf.pos.outbox']._cron_send()

    def test_transaction_rollback_removes_outbox(self):
        self.connector.action_activate()
        seen = []
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with self.env.cr.savepoint():
                seen.append(self._capture(self._order()).id)
                raise RuntimeError('rollback')
        self.assertFalse(self.env['pf.pos.outbox'].browse(seen).exists())

    def test_frozen_payload_retry_and_lost_acknowledgement(self):
        self.connector.action_activate()
        receipt = self._capture(self._order())
        frozen = receipt.payload
        self.partner1.phone = '+50255559999'
        with patch.object(type(receipt), '_post', return_value=(503, None)):
            receipt.sudo()._deliver()
        self.assertEqual(receipt.state, 'retry')
        self.assertEqual(receipt.payload, frozen)
        with patch.object(type(receipt), '_post', return_value=(200, {'ok':True,'result':{'duplicates':1,'errors':0}})):
            receipt.sudo()._deliver()
        self.assertEqual(receipt.state, 'done')
        self.assertEqual(receipt.attempts, 2)
        self.assertEqual(receipt.payload, frozen)

    def test_invalid_phone_review_without_stopping_checkout(self):
        self.connector.action_activate()
        self.partner1.phone = 'no phone'
        row = self._capture(self._order())
        self.assertEqual(row.state, 'review')
        self.assertEqual(row.reason, 'customer_phone')
        self.assertFalse(row.payload)

    def test_full_and_partial_refunds_keep_original_source(self):
        self.connector.action_activate()
        order = self._order(qty=2, amount=20)
        original = self._capture(order)
        refund = self._capture(self._order(qty=-2, refund_line=order.lines, amount=-20))
        data = json.loads(refund.payload)
        self.assertEqual(data['scope'], 'full')
        self.assertEqual(data['source'], json.loads(original.payload)['source'])
        self.assertEqual(data['originalSaleId'], json.loads(original.payload)['saleId'])
        self.assertNotIn('customerPhone', data)
        partial = self._capture(self._order(qty=-1, refund_line=order.lines, amount=-10))
        self.assertEqual(json.loads(partial.payload)['scope'], 'partial')
        with patch.object(type(partial), '_post', return_value=(200, {'ok':True,'refund':{'status':'pending','reason':'partial_refund'}})):
            partial.sudo()._deliver()
        self.assertEqual(partial.state, 'review')

    def test_admin_security_and_frozen_configuration(self):
        cashier = new_test_user(self.env, login='pf_fixture_cashier', groups='point_of_sale.group_pos_user')
        with self.assertRaises(AccessError):
            self.connector.with_user(cashier).read(['api_secret'])
        with self.assertRaises(AccessError):
            self.connector.with_user(cashier).action_activate()
        self.connector.action_activate()
        with self.assertRaises(UserError):
            self.connector.write({'base_url':'https://different.example'})
        receipt = self._capture(self._order())
        with self.assertRaises(AccessError):
            receipt.with_user(cashier).read(['payload'])
        with self.assertRaises(AccessError):
            receipt.with_user(cashier).action_retry()
        with self.assertRaises(AccessError):
            receipt.with_user(self.env.ref('base.user_admin')).write({'payload':'changed'})

    def test_network_failure_budget_and_manual_retry_preserves_bytes(self):
        from urllib3.exceptions import HTTPError
        self.connector.action_activate()
        receipt = self._capture(self._order()).sudo()
        frozen = receipt.payload
        with patch.object(type(receipt), '_post', side_effect=HTTPError('fixture body must never be stored')):
            receipt._deliver()
        self.assertEqual(receipt.state, 'retry')
        self.assertEqual(receipt.reason, 'network_error')
        receipt.write({'attempts':9})
        with patch.object(type(receipt), '_post', return_value=(503, None)):
            receipt._deliver()
        self.assertEqual(receipt.state, 'review')
        self.assertEqual(receipt.reason, 'retry_exhausted')
        receipt.action_retry()
        self.assertEqual(receipt.attempts, 0)
        self.assertEqual(receipt.total_attempts, 2)
        self.assertEqual(receipt.payload, frozen)

    def test_active_secret_cannot_be_cleared(self):
        from odoo.exceptions import ValidationError
        self.connector.action_activate()
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.connector.write({'api_secret':False})

    def test_cron_and_transport_send_frozen_signed_json(self):
        from unittest.mock import MagicMock
        from ..core import signature
        self.connector.action_activate()
        receipt = self._capture(self._order())
        receipt.sudo().write({'next_attempt':'2000-01-01 00:00:00'})
        session = MagicMock()
        response = session.__enter__.return_value.post.return_value.__enter__.return_value
        response.status_code = 200
        response.raw.read.return_value = b'{"ok":true,"result":{"awarded":1,"errors":0}}'
        with patch('requests.Session', return_value=session):
            self.env['pf.pos.outbox']._cron_send()
        sent = session.__enter__.return_value.post.call_args
        self.assertEqual(sent.args[0], 'https://pf-fixture.example/api/public/pos/fixture/sales')
        self.assertEqual(sent.kwargs['data'], receipt.payload.encode('utf-8'))
        self.assertEqual(sent.kwargs['headers']['x-signature'], signature(self.connector.api_secret, receipt.payload))
        self.assertFalse(sent.kwargs['allow_redirects'])
        self.assertEqual(receipt.state, 'done')
        with patch('requests.Session.send', side_effect=AssertionError('Confirmed receipt must not be sent again')):
            self.env['pf.pos.outbox']._cron_send()
