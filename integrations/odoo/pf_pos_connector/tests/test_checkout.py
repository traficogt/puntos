import json
from uuid import uuid4
from unittest.mock import patch
from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged, new_test_user
from odoo.addons.point_of_sale.tests.common import TestPointOfSaleCommon


@tagged('post_install', '-at_install')
class TestPfCheckout(TestPointOfSaleCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.product = cls.env['product.product'].create({
            'name': 'PF checkout coffee', 'type': 'consu', 'is_storable': True,
            'available_in_pos': True, 'list_price': 10, 'taxes_id': [Command.clear()],
        })
        cls.connector = cls.env['pf.pos.connector'].create({
            'name': 'Checkout fixture', 'pos_config_id': cls.pos_config.id,
            'base_url': 'https://pf-fixture.example', 'business_slug': 'fixture',
            'expected_currency': cls.pos_config.currency_id.name, 'api_secret': 'fixture-secret-never-real',
        })
        cls.pos_config.open_ui()
        cls.session = cls.pos_config.current_session_id
        cls.session.action_pos_session_open()
        cls.session.set_opening_control(0, 'Fixture opening')
        cls.session.update_stock_at_closing = False
        cls.connector.action_activate()
        cls.location = cls.pos_config.picking_type_id.default_location_src_id
        cls.env['stock.quant']._update_available_quantity(cls.product, cls.location, 20)
        cls.customer_id = '10000000-0000-4000-8000-000000000004'
        cls.mapping = dict(id='10000000-0000-4000-8000-000000000001', version=1,
                           reward_id='10000000-0000-4000-8000-000000000002', reward_name='Coffee',
                           branch_id=None, source=cls.connector.source, product_ref='product.product:%s' % cls.product.id,
                           quantity=1, item_kind='product', enabled=True)

    def _order(self, paid_qty=0):
        return self.env['pos.order'].create(dict(uuid=str(uuid4()), session_id=self.session.id, partner_id=self.partner1.id,
            amount_total=paid_qty * 10, amount_tax=0, amount_paid=paid_qty * 10, amount_return=0,
            lines=[Command.create(dict(product_id=self.product.id, qty=paid_qty, price_unit=10,
                price_subtotal=paid_qty * 10, price_subtotal_incl=paid_qty * 10, tax_ids=[Command.clear()]))] if paid_qty else []))

    def _options(self):
        return dict(ok=True, customer=dict(id=self.customer_id, name='Customer', points=100),
            rewards=[dict(rewardId=self.mapping['reward_id'], rewardName='Coffee', pointsCost=20,
                mapping=self.mapping, availability=dict(state='available', quantity=20, requiredQuantity=1,
                    observedAt='2026-11-11T00:00:00Z', source=self.connector.source))])

    def _prepare(self, order, request_id='10000000-0000-4000-8000-000000000005'):
        payload = dict(requestId=request_id, customerId=self.customer_id, customerQrToken='fixture-customer-qr-token',
                       rewardId=self.mapping['reward_id'], mappingId=self.mapping['id'], mappingVersion=1)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, self._options())) as remote:
            value = order.pf_checkout_prepare(payload)
        self.assertEqual([call.args[0] for call in remote.call_args_list], ['checkout_options'])
        self.assertFalse(order.lines.filtered(lambda line: line.price_unit == 0))
        return value

    def _authorized(self, request_id):
        return dict(ok=True, requestId=request_id, status='authorized', replay=False, mapping=self.mapping,
            redemption=dict(id='10000000-0000-4000-8000-000000000003', code='ABCDEF12', points_cost=20, balance_after=80))

    def _authorize(self, order, request_id):
        with patch.object(type(self.connector), '_reward_request', return_value=(200, self._authorized(request_id))):
            return order.pf_checkout_authorize(request_id)

    def test_prepare_never_debits_and_authorization_replay_preserves_one_actual_line(self):
        order = self._order()
        prepared = self._prepare(order)
        self.assertEqual(prepared['state'], 'pending')
        self._authorize(order, prepared['requestId'])
        self._authorize(order, prepared['requestId'])
        self.assertEqual(len(order.lines), 1)
        self.assertEqual(order.lines.product_id, self.product)
        self.assertEqual(order.lines.qty, 1)
        self.assertEqual(order.lines.price_subtotal_incl, 0)

    def test_unknown_authorization_keeps_intent_and_replays_exact_bytes(self):
        order = self._order()
        prepared = self._prepare(order)
        sent = []
        def transport(kind, payload):
            sent.append(payload)
            return (503, None) if len(sent) == 1 else (200, self._authorized(prepared['requestId']))
        with patch.object(type(self.connector), '_reward_request', side_effect=transport):
            self.assertEqual(order.pf_checkout_authorize(prepared['requestId'])['state'], 'pending')
            self.assertEqual(order.pf_checkout_authorize(prepared['requestId'])['state'], 'authorized')
        self.assertEqual(sent[0], sent[1])

    def test_cancel_is_durable_before_http_and_blocks_payment_until_confirmed(self):
        order = self._order()
        prepared = self._prepare(order)
        self._authorize(order, prepared['requestId'])
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('no remote call while preparing cancellation')):
            cancelled = order.pf_checkout_prepare_cancel(prepared['requestId'], 'Customer changed their mind')
        self.assertEqual(cancelled['state'], 'cancel_pending')
        self.assertFalse(order.lines)
        with self.assertRaises(UserError):
            order._process_saved_order(False)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, dict(ok=True, requestId=prepared['requestId'], status='cancelled', replay=False))):
            self.assertEqual(order.pf_checkout_cancel(prepared['requestId'])['state'], 'cancelled')

    def test_paid_receipt_automatically_queues_bound_evidence_without_network(self):
        order = self._order()
        prepared = self._prepare(order)
        self._authorize(order, prepared['requestId'])
        with patch('requests.Session.send', side_effect=AssertionError('payment must never call PF')):
            order._process_saved_order(False)
        link = self.env['pf.pos.reward.fulfillment'].search([('order_id', '=', order.id)])
        self.assertEqual(len(link), 1)
        data = json.loads(link.event_ids.filtered(lambda event: event.kind == 'recorded').payload)
        self.assertEqual(data['checkoutRequestId'], prepared['requestId'])
        self.assertEqual(data['cartId'], order.uuid)
        self.assertEqual(data['cartLineId'], order.lines.uuid)
        self.assertEqual(link.stock_status, 'done')
        with self.assertRaises(UserError):
            order.pf_checkout_prepare_cancel(prepared['requestId'], 'Already paid')

    def test_stock_customer_and_line_changes_are_rechecked_before_payment(self):
        order = self._order(paid_qty=19)
        prepared = self._prepare(order)
        self._authorize(order, prepared['requestId'])
        self.env['stock.quant']._update_available_quantity(self.product, self.location, -1)
        with self.assertRaises(UserError):
            order._process_saved_order(False)
        self.env['stock.quant']._update_available_quantity(self.product, self.location, 1)
        with self.assertRaises(UserError), self.env.cr.savepoint():
            order.partner_id = self.env['res.partner'].create({'name': 'Different checkout customer'})
            order._process_saved_order(False)
        reward_line = order.lines.filtered(lambda line: line.price_unit == 0)
        with self.assertRaises(UserError), self.env.cr.savepoint():
            reward_line.qty = 2

    def test_non_pos_user_cannot_prepare_or_inspect_and_fixed_tax_rejected_before_debit(self):
        user = new_test_user(self.env, login='pf_checkout_unprivileged', groups='base.group_user')
        order = self._order()
        with self.assertRaises(AccessError):
            order.with_user(user).pf_checkout_status()
        tax = self.env['account.tax'].create(dict(name='Fixed charge', amount_type='fixed', amount=1, type_tax_use='sale'))
        self.product.taxes_id = tax
        with self.assertRaises(UserError):
            self._prepare(order)

    def test_pending_other_checkout_consumes_local_availability(self):
        self.env['stock.quant']._update_available_quantity(self.product, self.location, -19)
        self._prepare(self._order())
        with self.assertRaises(UserError):
            self._prepare(self._order(), '10000000-0000-4000-8000-000000000006')

    def test_catalog_and_inventory_publish_actual_variants_and_location_stock(self):
        self.assertTrue(callable(getattr(self.connector, 'action_publish_catalog', None)))
        self.connector.pf_branch_id = '10000000-0000-4000-8000-000000000010'
        calls = []
        def transport(kind, payload):
            calls.append((kind, json.loads(payload)))
            return 200, dict(ok=True, replay=False)
        with patch.object(type(self.connector), '_reward_request', side_effect=transport):
            self.connector.action_publish_catalog()
        catalog = [item for kind, body in calls if kind == 'catalog_sync' for item in body['items']]
        self.assertTrue(any(item['productRef'] == 'product.product:%s' % self.product.id and item['active'] for item in catalog))
        inventory = [item for kind, body in calls if kind == 'inventory_snapshot' for item in body['items']]
        self.assertEqual(next(item['availableQuantity'] for item in inventory if item['productRef'] == 'product.product:%s' % self.product.id), 20)
        self.assertEqual(len({body['requestId'] for _, body in calls}), len(calls))

    def test_cannot_remove_authorized_line_or_cancel_order_without_pf_confirmation(self):
        order = self._order()
        prepared = self._prepare(order)
        self._authorize(order, prepared['requestId'])
        with self.assertRaises(UserError):
            order.lines.unlink()
        with self.assertRaises(UserError):
            order.action_pos_order_cancel()

    def test_authorization_acknowledgement_rollback_keeps_original_pending_intent(self):
        order = self._order()
        prepared = self._prepare(order)
        with self.assertRaises(RuntimeError), self.env.cr.savepoint():
            self._authorize(order, prepared['requestId'])
            raise RuntimeError('local transaction lost after PF acknowledged')
        self.assertFalse(order.lines)
        self.assertEqual(order.pf_checkout_status()['intents'][0]['state'], 'pending')
        self._authorize(order, prepared['requestId'])
        self.assertEqual(len(order.lines), 1)

    def test_configuration_change_blocks_authorization_and_partner_change_is_prevented(self):
        order = self._order()
        prepared = self._prepare(order)
        with self.assertRaises(UserError), self.env.cr.savepoint():
            order.partner_id = self.env['res.partner'].create({'name': 'Replacement customer'})
        fiscal = self.env['account.fiscal.position'].create({'name': 'Changed fiscal position'})
        order.fiscal_position_id = fiscal
        with self.assertRaises(UserError):
            self._authorize(order, prepared['requestId'])

    def test_direct_order_cancellation_cannot_bypass_pf_cancellation(self):
        order = self._order()
        self._prepare(order)
        with self.assertRaises(UserError):
            order.write({'state': 'cancel'})

    def test_invoice_finalization_does_not_check_already_consumed_stock_twice(self):
        self.env['stock.quant']._update_available_quantity(self.product, self.location, -19)
        order = self._order()
        order.to_invoice = True
        prepared = self._prepare(order)
        self._authorize(order, prepared['requestId'])
        order._process_saved_order(False)
        self.assertEqual(order.state, 'invoiced')
        self.assertEqual(order.pf_checkout_status()['intents'][0]['state'], 'recorded')

    def test_cancelled_remote_tombstone_cannot_create_a_reward_line(self):
        order = self._order()
        prepared = self._prepare(order)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, dict(ok=True,
                requestId=prepared['requestId'], status='cancelled', redemption=None, mapping=None, replay=True))):
            self.assertEqual(order.pf_checkout_authorize(prepared['requestId'])['state'], 'cancelled')
        self.assertFalse(order.lines)

    def test_branch_identity_is_frozen_after_checkout_even_without_mapping_refresh(self):
        self._prepare(self._order())
        with self.assertRaises(UserError):
            self.connector.pf_branch_id = '10000000-0000-4000-8000-000000000010'

    def test_cart_uuid_write_is_blocked_for_pending_authorized_and_recorded_checkout(self):
        order = self._order()
        prepared = self._prepare(order)
        original = order.uuid
        for state in ('pending', 'authorized', 'recorded'):
            with self.subTest(state=state):
                if state == 'authorized':
                    self._authorize(order, prepared['requestId'])
                elif state == 'recorded':
                    order._process_saved_order(False)
                # Resending an unchanged UUID is a normal POS synchronization.
                order.write({'uuid': original})
                with self.assertRaises(UserError), self.env.cr.savepoint():
                    order.write({'uuid': '20000000-0000-4000-8000-000000000001'})
                self.assertEqual(order.uuid, original)

    def test_cart_uuid_mismatch_blocks_remote_authorization_and_payment(self):
        order = self._order()
        prepared = self._prepare(order)
        changed = '20000000-0000-4000-8000-000000000002'
        # Simulate an out-of-band correction bypassing the public write guard.
        order.flush_recordset(['uuid'])
        self.env.cr.execute('UPDATE pos_order SET uuid=%s WHERE id=%s', [changed, order.id])
        order.invalidate_recordset(['uuid'])
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('identity mismatch must precede HTTP')):
            with self.assertRaises(UserError):
                order.pf_checkout_authorize(prepared['requestId'])
        order = self._order()
        prepared = self._prepare(order, '10000000-0000-4000-8000-000000000006')
        self._authorize(order, prepared['requestId'])
        order.flush_recordset(['uuid'])
        self.env.cr.execute('UPDATE pos_order SET uuid=%s WHERE id=%s', ['20000000-0000-4000-8000-000000000003', order.id])
        order.invalidate_recordset(['uuid'])
        with self.assertRaises(UserError):
            order._process_saved_order(False)
        self.assertEqual(order.state, 'draft')
        self.assertFalse(order.picking_ids)
        self.assertFalse(self.env['pf.pos.reward.fulfillment'].search([('order_id', '=', order.id)]))
