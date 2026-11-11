import json
from unittest.mock import patch
from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged, new_test_user
from odoo.addons.point_of_sale.tests.common import TestPointOfSaleCommon


@tagged('post_install', '-at_install')
class TestPfRewards(TestPointOfSaleCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner1.phone = '+50255554444'
        cls.product = cls.env['product.product'].create({
            'name': 'PF actual stock item', 'type': 'consu', 'is_storable': True,
            'available_in_pos': True, 'list_price': 10, 'taxes_id': [Command.clear()],
        })
        cls.service = cls.env['product.product'].create({
            'name': 'PF actual service', 'type': 'service', 'available_in_pos': True,
            'list_price': 10, 'taxes_id': [Command.clear()],
        })
        cls.connector = cls.env['pf.pos.connector'].create({
            'name': 'PF isolated reward fixture', 'pos_config_id': cls.pos_config.id,
            'base_url': 'https://pf-fixture.example', 'business_slug': 'fixture',
            'expected_currency': cls.pos_config.currency_id.name,
            'api_secret': 'fixture-secret-never-real',
        })
        cls.pos_config.open_ui()
        cls.session = cls.pos_config.current_session_id
        cls.session.action_pos_session_open()
        cls.session.update_stock_at_closing = False
        cls.connector.action_activate()
        cls.location = cls.pos_config.picking_type_id.default_location_src_id
        cls.env['stock.quant']._update_available_quantity(cls.product, cls.location, 20)

    def _mapping(self, product=None, quantity=1, version=1):
        product = product or self.product
        return dict(id='10000000-0000-4000-8000-000000000001', version=version,
                    reward_id='10000000-0000-4000-8000-000000000002', reward_name='Coffee',
                    branch_id=None, source=self.connector.source,
                    product_ref='product.product:%s' % product.id, quantity=quantity,
                    item_kind='service' if product.type == 'service' else 'product', enabled=True)

    def _refresh(self, mapping=None):
        data = {'ok': True, 'currency': self.connector.expected_currency, 'mappings': [mapping or self._mapping()]}
        with patch.object(type(self.connector), '_reward_request', return_value=(200, data)):
            self.connector.action_refresh_mappings()

    def _order(self, product=None, qty=1, price=0, original=None, extra_paid=False):
        product = product or self.product
        line = dict(product_id=product.id, qty=qty, price_unit=price,
                    price_subtotal=qty * price, price_subtotal_incl=qty * price,
                    tax_ids=[Command.clear()])
        if original:
            line['refunded_orderline_id'] = original.id
        lines = [Command.create(line)]
        total = qty * price
        if extra_paid:
            total += 10
            lines.append(Command.create(dict(product_id=product.id, qty=1, price_unit=10,
                                            price_subtotal=10, price_subtotal_incl=10, tax_ids=[Command.clear()])))
        order = self.env['pos.order'].create(dict(
            session_id=self.session.id, partner_id=self.partner1.id, amount_total=total,
            amount_tax=0, amount_paid=total, amount_return=0, lines=lines,
            payment_ids=[Command.create(dict(amount=total, payment_method_id=self.cash_payment_method.id))] if total else [],
        ))
        with patch('requests.Session.send', side_effect=AssertionError('POS processing must not send HTTP')):
            order._process_saved_order(False)
        self.assertEqual(order.state, 'paid')
        return order

    def _link(self, order, mapping=None, redemption='10000000-0000-4000-8000-000000000003', user=None):
        mapping = mapping or self._mapping()
        model = self.env['pf.pos.link.wizard'].with_user(user) if user else self.env['pf.pos.link.wizard']
        wizard = model.create({'order_id': order.id, 'line_id': order.lines[0].id, 'code': 'ABCDEF12'})
        data = {'ok': True, 'redemption': dict(id=redemption, code='ABCDEF12', reward_id=mapping['reward_id'],
                reward_name='Coffee', branch_id=None, currency=self.connector.expected_currency, status='REDEEMED'),
                'mapping': mapping, 'fulfillment': None}
        with patch.object(type(self.connector), '_reward_request', return_value=(200, data)):
            wizard.action_lookup()
        with patch('requests.Session.send', side_effect=AssertionError('Record link must queue without HTTP')):
            wizard.action_record()
        return self.env['pf.pos.reward.fulfillment'].search([('order_line_id', '=', order.lines[0].id)])

    def test_normal_free_pos_stock_and_link_replay_never_move_stock_twice(self):
        self.assertIn('pf.pos.link.wizard', self.env.registry, 'Reward linking wizard must be installed')
        self._refresh()
        order = self._order()
        self.assertEqual(order.picking_ids.state, 'done')
        self.assertEqual(self.env['stock.quant']._get_available_quantity(self.product, self.location), 19)
        self.assertEqual(self.env['pf.pos.outbox'].search([('order_id', '=', order.id)]).state, 'skipped')
        link = self._link(order)
        event = link.event_ids.filtered(lambda row: row.kind == 'recorded')
        payload = json.loads(event.payload)
        self.assertEqual((payload['productRef'], payload['stockStatus'], payload['lineTotal']),
                         ('product.product:%s' % self.product.id, 'done', 0))
        self.assertNotIn('customerPhone', payload)
        self.assertEqual(self._link(order), link)
        self.assertEqual(len(link.event_ids), 1)
        self.assertEqual(self.env['stock.quant']._get_available_quantity(self.product, self.location), 19)

    def test_mixed_receipt_excludes_mapped_free_qty_but_keeps_refund_snapshot(self):
        self._refresh()
        order = self._order(extra_paid=True)
        receipt = self.env['pf.pos.outbox'].search([('order_id', '=', order.id)])
        self.assertEqual(json.loads(receipt.payload)['items'], 1)
        self.assertEqual(len(receipt.original_snapshot), 2)
        frozen = receipt.payload
        self._link(order)
        self.assertEqual(receipt.payload, frozen)

    def test_service_has_no_inventory_and_deferred_inventory_emits_update(self):
        self._refresh(self._mapping(self.service))
        service_order = self._order(self.service)
        link = self._link(service_order, self._mapping(self.service))
        self.assertFalse(service_order.picking_ids)
        self.assertEqual(json.loads(link.event_ids.payload)['stockStatus'], 'not_applicable')
        self._refresh(self._mapping(version=2))
        self.session.update_stock_at_closing = True
        order = self._order()
        link = self._link(order, self._mapping(version=2), redemption='10000000-0000-4000-8000-000000000004')
        event = link.event_ids
        self.assertEqual(json.loads(event.payload)['stockStatus'], 'pending')
        self.session.update_stock_at_closing = False
        order._create_order_picking()
        self.env['pf.pos.reward.event']._capture_stock_updates()
        update = link.event_ids.filtered(lambda row: row.kind == 'stock_updated')
        self.assertEqual(json.loads(update.payload)['stockStatus'], 'done')
        self.assertEqual(json.loads(update.payload).get('lineTotal'), 0)
        self.env['pf.pos.reward.event']._capture_stock_updates()
        self.assertEqual(len(link.event_ids), 2)

    def test_return_of_free_reward_is_queued_with_original_snapshot(self):
        self._refresh()
        original = self._order()
        link = self._link(original)
        self._refresh(self._mapping(version=2))
        returned = self._order(qty=-1, original=original.lines)
        event = link.event_ids.filtered(lambda row: row.kind == 'reversed')
        data = json.loads(event.payload)
        self.assertEqual(data.get('lineTotal'), 0)
        self.assertEqual((data['quantity'], data['mappingVersion'], data['lineId'], data['stockStatus']),
                         (1, 1, 'pos.order.line:%s' % returned.lines.id, 'returned'))
        self.assertEqual(link.reconciliation_state, 'review')
        self.assertEqual(self.env['stock.quant']._get_available_quantity(self.product, self.location), 20)
        returned._process_saved_order(False)
        self.assertEqual(len(link.event_ids.filtered(lambda row: row.kind == 'reversed')), 1)

    def test_reject_wrong_product_quantity_price_and_already_returned_line(self):
        self._refresh()
        for order in (self._order(self.service), self._order(qty=2), self._order(price=10)):
            with self.assertRaises(UserError), self.env.cr.savepoint():
                self._link(order)
        order = self._order()
        self._order(qty=-1, original=order.lines)
        with self.assertRaises(UserError), self.env.cr.savepoint():
            self._link(order)

    def test_frozen_queue_retry_identity_and_review_acknowledgement(self):
        self._refresh()
        link = self._link(self._order())
        event = link.event_ids.sudo()
        frozen = event.payload
        with patch.object(type(self.connector), '_reward_request', return_value=(503, {})):
            event._deliver()
        self.assertEqual(event.state, 'retry')
        data = json.loads(frozen)
        ack = dict(ok=True, eventId=data['eventId'], redemptionId=data['redemptionId'], status='recorded', replay=True)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, ack)):
            event._deliver()
        self.assertEqual(event.state, 'done')
        self.assertEqual(event.payload, frozen)
        self.assertEqual(link.reconciliation_state, 'recorded')

    def test_cashier_denied_manager_can_link_and_queue_is_immutable(self):
        self._refresh()
        cashier = new_test_user(self.env, login='pf_reward_cashier', groups='point_of_sale.group_pos_user')
        manager = new_test_user(self.env, login='pf_reward_manager', groups='point_of_sale.group_pos_manager')
        with self.assertRaises(AccessError):
            self.connector.with_user(manager).action_refresh_mappings()
        with self.assertRaises(AccessError):
            self.env['pf.pos.link.wizard'].with_user(cashier).create({'code': 'ABCDEF12'})
        order = self._order()
        with self.assertRaises(RuntimeError), self.env.cr.savepoint():
            self._link(order)
            raise RuntimeError('rollback')
        self.assertFalse(self.env['pf.pos.reward.fulfillment'].search([('order_line_id', '=', order.lines.id)]))
        link = self._link(order, user=manager)
        self.assertEqual(link.with_user(manager).read(['redemption_code'])[0]['redemption_code'], 'ABCDEF12')
        with self.assertRaises(AccessError):
            link.event_ids.with_user(manager).read(['payload'])
        with self.assertRaises(AccessError):
            link.event_ids.with_user(self.env.ref('base.user_admin')).write({'payload': '{}'})

    def test_wizard_context_cannot_inject_verified_pf_response(self):
        self._refresh()
        manager = new_test_user(self.env, login='pf_reward_context_manager', groups='point_of_sale.group_pos_manager')
        order = self._order()
        wizard = self.env['pf.pos.link.wizard'].with_user(manager).with_context(default_verified_snapshot={'ok': True}).create({
            'order_id': order.id, 'line_id': order.lines.id, 'code': 'ABCDEF12'})
        self.assertFalse(wizard.verified_snapshot, 'Client context must never supply verified response data')
        with self.assertRaises(UserError):
            wizard.action_record()

    def test_archived_disabled_mapping_can_be_refreshed_without_losing_history(self):
        self._refresh()
        self.product.active = False
        self._refresh({**self._mapping(version=2), 'enabled': False})
        self.assertFalse(self.connector.reward_mapping_ids.filtered('enabled'))
        self.assertEqual(len(self.connector.reward_mapping_ids), 2)

    def test_unfinished_picking_is_pending_and_later_observation_does_not_move_stock(self):
        self._refresh()
        with patch.object(type(self.env['stock.picking']), '_action_done', side_effect=UserError('fixture stock issue')):
            order = self._order()
        self.assertNotEqual(order.picking_ids.state, 'done')
        link = self._link(order)
        self.assertEqual(link.stock_status, 'pending')
        before = self.env['stock.quant']._get_available_quantity(self.product, self.location)
        self.env['pf.pos.reward.event']._capture_stock_updates()
        self.assertEqual(len(link.event_ids), 1)
        self.assertEqual(self.env['stock.quant']._get_available_quantity(self.product, self.location), before)

    def test_second_redemption_cannot_reuse_line_and_original_code_cannot_move(self):
        self._refresh()
        first = self._order()
        self._link(first)
        with self.assertRaises(UserError), self.env.cr.savepoint():
            self._link(first, redemption='10000000-0000-4000-8000-000000000099')
        with self.assertRaises(UserError), self.env.cr.savepoint():
            self._link(self._order())

    def test_partial_returns_wait_for_original_ack_and_review_ack_stops_retry(self):
        mapping = self._mapping(quantity=2)
        self._refresh(mapping)
        order = self._order(qty=2)
        link = self._link(order, mapping)
        original = link.event_ids.sudo()
        self._order(qty=-1, original=order.lines)
        returned = link.event_ids.sudo().filtered(lambda row: row.kind == 'reversed')
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('Parent must be acknowledged first')):
            returned._deliver()
        ack = dict(ok=True, eventId=original.event_id, redemptionId=link.redemption_id, status='recorded', replay=False)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, ack)):
            original._deliver()
        ack.update(eventId=returned.event_id, status='review')
        with patch.object(type(self.connector), '_reward_request', return_value=(200, ack)):
            returned._deliver()
        self.assertEqual(returned.state, 'done')
        self.assertEqual(link.reconciliation_state, 'review')
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('Acknowledged review must not resend')):
            returned._deliver()
        self._order(qty=-2, original=order.lines)
        self.assertEqual(link.review_reason, 'returned_quantity_exceeded')
        self.assertEqual(len(link.event_ids.filtered(lambda row: row.kind == 'reversed')), 1)

    def test_signed_transport_frozen_bytes_pause_and_retry_budget(self):
        from unittest.mock import MagicMock
        from ..core import signature
        self._refresh()
        link = self._link(self._order())
        event = link.event_ids.sudo()
        session = MagicMock()
        response = session.__enter__.return_value.post.return_value.__enter__.return_value
        response.status_code = 503
        response.raw.read.return_value = b'{}'
        with patch('requests.Session', return_value=session):
            event._deliver()
        sent = session.__enter__.return_value.post.call_args
        self.assertTrue(sent.args[0].endswith('/redemptions/events'))
        self.assertEqual(sent.kwargs['data'], event.payload.encode('utf-8'))
        self.assertEqual(sent.kwargs['headers']['x-signature'], signature(self.connector.api_secret, event.payload))
        self.assertFalse(session.__enter__.return_value.trust_env)
        event.sudo().write({'attempts': 9})
        with patch.object(type(self.connector), '_reward_request', return_value=(503, {})):
            event._deliver()
        self.assertEqual(event.state, 'review')
        event.action_retry()
        self.assertEqual(event.attempts, 0)
        self.connector.action_pause()
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('Paused evidence cannot send')):
            event._deliver()

    def test_mapping_must_precede_the_immutable_paid_sale_capture(self):
        order = self._order(extra_paid=True)
        receipt = self.env['pf.pos.outbox'].search([('order_id', '=', order.id)])
        self.assertEqual(json.loads(receipt.payload)['items'], 2)
        frozen = receipt.payload
        self._refresh()
        with self.assertRaises(UserError), self.env.cr.savepoint():
            self._link(order)
        self.assertEqual(receipt.payload, frozen)

    def test_delivery_recovery_clears_transport_review_without_erasing_return_review(self):
        self._refresh()
        link = self._link(self._order()).sudo()
        event = link.event_ids
        with patch.object(type(self.connector), '_reward_request', return_value=(409, {})):
            event._deliver()
        self.assertEqual(link.reconciliation_state, 'review')
        event.action_retry()
        ack = dict(ok=True, eventId=event.event_id, redemptionId=link.redemption_id, status='recorded', replay=True)
        with patch.object(type(self.connector), '_reward_request', return_value=(200, ack)):
            event._deliver()
        self.assertEqual(link.reconciliation_state, 'recorded')

    def test_lookup_uses_redemption_display_name_when_mapping_response_has_no_name(self):
        self._refresh()
        order = self._order()
        mapping = self._mapping()
        mapping.pop('reward_name')
        wizard = self.env['pf.pos.link.wizard'].create({'order_id': order.id, 'line_id': order.lines.id, 'code': 'ABCDEF12'})
        response = dict(ok=True, mapping=mapping, fulfillment=None, redemption=dict(
            id='10000000-0000-4000-8000-000000000003', code='ABCDEF12', reward_id=mapping['reward_id'],
            reward_name='Protected original name', branch_id=None, currency=self.connector.expected_currency, status='REDEEMED'))
        with patch.object(type(self.connector), '_reward_request', return_value=(200, response)):
            wizard.action_lookup()
        wizard.action_record()
        link = self.env['pf.pos.reward.fulfillment'].search([('order_line_id', '=', order.lines.id)])
        self.assertEqual(link.reward_name, 'Protected original name')
        self._refresh({**self._mapping(), 'reward_name': 'Renamed reward'})

    def test_nonzero_return_line_is_reviewed_without_claiming_zero_price(self):
        self._refresh()
        order = self._order()
        link = self._link(order)
        self._order(qty=-1, price=10, original=order.lines)
        self.assertEqual(link.review_reason, 'return_price_mismatch')
        self.assertFalse(link.event_ids.filtered(lambda row: row.kind == 'reversed'))

    def test_stock_observation_rejects_a_changed_paid_line(self):
        self._refresh()
        self.session.update_stock_at_closing = True
        order = self._order()
        link = self._link(order)
        other = self.env['product.product'].create({'name': 'Different real product', 'type': 'consu', 'is_storable': True, 'available_in_pos': True, 'taxes_id': [Command.clear()]})
        order.lines.write({'product_id': other.id})
        self.session.update_stock_at_closing = False
        order._create_order_picking()
        self.assertEqual(order.picking_ids.state, 'done')
        self.env['pf.pos.reward.event']._capture_stock_updates()
        self.assertFalse(link.event_ids.filtered(lambda row: row.kind == 'stock_updated'))
        self.assertEqual(link.review_reason, 'receipt_evidence_changed')
        with patch.object(type(self.connector), '_reward_request', side_effect=AssertionError('Changed receipt must remain in review')):
            link.event_ids.sudo()._deliver()
        self.assertEqual(link.event_ids.state, 'review')

    def test_return_rejects_an_original_line_changed_after_linking(self):
        self._refresh()
        order = self._order()
        link = self._link(order)
        other = self.env['product.product'].create({'name': 'Different returned product', 'type': 'consu', 'is_storable': True, 'available_in_pos': True, 'taxes_id': [Command.clear()]})
        order.lines.write({'product_id': other.id})
        self._order(product=other, qty=-1, original=order.lines)
        self.assertFalse(link.event_ids.filtered(lambda row: row.kind == 'reversed'))
        self.assertEqual(link.review_reason, 'receipt_evidence_changed')
