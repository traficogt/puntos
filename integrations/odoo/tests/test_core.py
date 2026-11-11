import importlib.util
import json
import unittest
from pathlib import Path

CORE = Path(__file__).parents[1] / 'pf_pos_connector' / 'core.py'

class CoreContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert CORE.is_file(), 'Installable connector must include its executable normalization contract'
        spec = importlib.util.spec_from_file_location('pf_core', CORE)
        cls.core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.core)

    def sale(self, **overrides):
        return self.core.sale_payload(source='odoo:db:1:2', receipt_id='pos.order:7', phone='+502 5555-4444', amount=75, currency='GTQ', expected_currency='GTQ', quantities=[1, 2], **overrides)

    def test_sale_identity_phone_currency_and_bytes(self):
        data = self.sale()
        self.assertEqual(data, {'saleId':'pos.order:7','source':'odoo:db:1:2','customerPhone':'50255554444','amountQ':75.0,'currency':'GTQ','status':'paid','items':3})
        body = self.core.encode_payload(data)
        self.assertEqual(json.loads(body), data)
        self.assertEqual(self.core.signature('fixture-secret', body), 'sha256=d403a6b9d2de999c5c4b1d0d8b99e3d717f6cee9f7e78c278ae93315fdc851ac')

    def test_fractional_quantity_no_invented_item_count(self):
        args = dict(source='odoo:db:1:2', receipt_id='pos.order:1', phone='50255554444', amount=12, currency='USD', expected_currency='USD', quantities=[0.5, 2])
        self.assertEqual(self.core.sale_payload(**args)['items'], 0)
        for field, value, reason in [('currency','GTQ','currency_mismatch'),('phone','abc55554444','customer_phone'),('amount',12.345,'amount_precision'),('quantities',[-1],'mixed_sale_refund')]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, reason):
                self.core.sale_payload(**{**args, field:value})

    def test_refund_full_only_with_all_lines_and_matching_amount(self):
        args = dict(source='odoo:db:1:2', receipt_id='pos.order:8', original_id='pos.order:7', amount=75, original_amount=75, currency='GTQ', expected_currency='GTQ', original_lines={1:2,2:1}, returned_lines={1:2,2:1})
        self.assertEqual(self.core.refund_payload(**args)['scope'], 'full')
        self.assertEqual(self.core.refund_payload(**{**args,'returned_lines':{1:2}})['scope'], 'partial')
        self.assertEqual(self.core.refund_payload(**{**args,'amount':30})['scope'], 'partial')
        self.assertNotIn('customerPhone', self.core.refund_payload(**args))

    def test_acknowledgement_is_not_just_http_200(self):
        for status in [408,429,500,503]:
            self.assertEqual(self.core.delivery_outcome(status, None, 'sale'), ('retry','http_retry'))
        for status in [301,401,403,409,422]:
            self.assertEqual(self.core.delivery_outcome(status, None, 'sale'), ('review','http_rejected'))
        self.assertEqual(self.core.delivery_outcome(200, {'ok':True,'result':{'awarded':0,'duplicates':0,'errors':1}}, 'sale'), ('review','sale_not_applied'))
        self.assertEqual(self.core.delivery_outcome(200, {'ok':True,'result':{'awarded':0,'duplicates':1,'errors':0}}, 'sale'), ('done','duplicate'))
        self.assertEqual(self.core.delivery_outcome(200, {'ok':True,'refund':{'status':'pending','reason':'partial_refund'}}, 'refund'), ('review','refund_pending'))
        self.assertEqual(self.core.delivery_outcome(200, {}, 'sale'), ('retry','unrecognized_response'))

    def test_bounded_backoff_and_authorized_https_origin(self):
        self.assertEqual([self.core.retry_delay(i) for i in [1,2,10,100]], [60,120,3600,3600])
        self.assertEqual(self.core.endpoint('https://pf.example/', 'cafe-1', 'sale'), 'https://pf.example/api/public/pos/cafe-1/sales')
        for origin in ['http://pf.example','https://user:pass@pf.example','https://pf.example/path','https://pf.example?x=y','https://127.0.0.1','https://localhost']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                self.core.endpoint(origin, 'cafe', 'sale')

if __name__ == '__main__':
    unittest.main()
