import importlib.util
import unittest
from pathlib import Path


class RewardContract(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).parents[1] / 'pf_pos_connector' / 'core.py'
        spec = importlib.util.spec_from_file_location('pf_core', path)
        self.core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.core)

    def test_reward_endpoints_are_fixed_signed_post_destinations(self):
        for kind in ('lookup', 'events', 'mappings'):
            self.assertEqual(self.core.endpoint('https://pf.example', 'cafe', kind),
                             'https://pf.example/api/public/pos/cafe/redemptions/' + kind)

    def test_reward_ack_must_match_both_identifiers(self):
        self.assertTrue(hasattr(self.core, 'reward_delivery_outcome'), 'Reward acknowledgements need identity verification')
        data = {'ok': True, 'eventId': 'event:1', 'redemptionId': 'red:1', 'status': 'review', 'replay': False}
        self.assertEqual(self.core.reward_delivery_outcome(200, data, 'event:1', 'red:1'), ('done', 'review'))
        self.assertEqual(self.core.reward_delivery_outcome(200, data, 'event:2', 'red:1'), ('retry', 'unrecognized_response'))
        self.assertEqual(self.core.reward_delivery_outcome(409, {}, 'event:1', 'red:1'), ('review', 'http_rejected'))
        self.assertEqual(self.core.reward_delivery_outcome(503, {}, 'event:1', 'red:1'), ('retry', 'http_retry'))

    def test_mapping_strict_quantity_and_scope(self):
        self.assertTrue(hasattr(self.core, 'validated_mapping'), 'Mappings need strict wire validation')
        mapping = dict(id='10000000-0000-4000-8000-000000000001', version=1,
                       reward_id='10000000-0000-4000-8000-000000000002', reward_name='Coffee',
                       branch_id=None, source='odoo:db:1:1', product_ref='product.product:4',
                       quantity=1, item_kind='product', enabled=True)
        self.assertEqual(self.core.validated_mapping(mapping, 'odoo:db:1:1', None), mapping)
        for changes in ({'quantity': 0}, {'quantity': 0.0000001}, {'quantity': float('nan')},
                        {'version': True}, {'source': 'other'}, {'product_ref': 'product.template:4'},
                        {'branch_id': '10000000-0000-4000-8000-000000000003'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.core.validated_mapping({**mapping, **changes}, 'odoo:db:1:1', None)
