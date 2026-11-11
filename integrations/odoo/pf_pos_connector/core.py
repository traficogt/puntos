"""PF wire contract, deliberately independent of Odoo and network access."""
import hashlib
import hmac
import ipaddress
import json
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount > Decimal('99999999.99'):
            raise ValueError('amount_range')
        if abs(amount - amount.quantize(Decimal('0.01'))) > Decimal('0.0000001'):
            raise ValueError('amount_precision')
        return float(amount.quantize(Decimal('0.01')))
    except InvalidOperation as exc:
        raise ValueError('amount_range') from exc


def check_currency(currency, expected_currency):
    if not re.fullmatch(r'[A-Z]{3}', expected_currency or '') or currency != expected_currency:
        raise ValueError('currency_mismatch')


def sale_payload(*, source, receipt_id, phone, amount, currency, expected_currency, quantities):
    check_currency(currency, expected_currency)
    if not isinstance(phone, str) or not re.fullmatch(r'[+\d\s().-]+', phone, flags=re.ASCII):
        raise ValueError('customer_phone')
    digits = re.sub(r'\D', '', phone)
    # Explicit international digits avoid guessing a country from a local number.
    if not re.fullmatch(r'[1-9][0-9]{8,14}', digits):
        raise ValueError('customer_phone')
    counts = [Decimal(str(q)) for q in quantities]
    if not counts or any(not q.is_finite() or q < 0 for q in counts):
        raise ValueError('mixed_sale_refund')
    items = int(sum(counts)) if all(q == int(q) for q in counts) else 0
    if items > 2147483647:
        raise ValueError('items_range')
    return dict(saleId=receipt_id, source=source, customerPhone=digits, amountQ=money(amount), currency=currency, status='paid', items=items)


def refund_payload(*, source, receipt_id, original_id, amount, original_amount, currency, expected_currency, original_lines, returned_lines):
    check_currency(currency, expected_currency)
    value = money(amount)
    full = value == money(original_amount) and bool(original_lines) and original_lines == returned_lines
    return dict(refundId=receipt_id, originalSaleId=original_id, source=source, amountQ=value, currency=currency, scope='full' if full else 'partial')


def encode_payload(payload):
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)


def signature(secret, body):
    return 'sha256=' + hmac.new(secret.encode('utf-8'), body.encode('utf-8'), hashlib.sha256).hexdigest()


def endpoint(origin, slug, kind):
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('https_origin_required')
    if parsed.hostname.lower() == 'localhost' or '.' not in parsed.hostname:
        raise ValueError('public_origin_required')
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError('public_origin_required')
    paths = {'sale': 'sales', 'refund': 'refunds', 'lookup': 'redemptions/lookup', 'events': 'redemptions/events', 'mappings': 'redemptions/mappings',
             'checkout_options': 'checkout/options', 'checkout_authorize': 'checkout/authorize', 'checkout_status': 'checkout/status',
             'checkout_cancel': 'checkout/cancel', 'catalog_sync': 'catalog/sync', 'inventory_snapshot': 'inventory/snapshot'}
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', slug or '') or kind not in paths:
        raise ValueError('destination_invalid')
    return origin.rstrip('/') + '/api/public/pos/' + slug + '/' + paths[kind]


def retry_delay(attempt):
    return min(3600, 60 * 2 ** min(max(attempt - 1, 0), 6))


def valid_uuid(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', value))


def reward_quantity(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError('quantity_invalid')
    quantity = Decimal(str(value))
    if not quantity.is_finite() or quantity <= 0 or quantity > 1000000 or quantity != quantity.quantize(Decimal('0.000001')):
        raise ValueError('quantity_invalid')
    return float(quantity)


def validated_mapping(value, source, branch_id):
    if not isinstance(value, dict):
        raise ValueError('mapping_invalid')
    required = {'id', 'version', 'reward_id', 'reward_name', 'branch_id', 'source', 'product_ref', 'quantity', 'item_kind'}
    if not required <= value.keys() or not valid_uuid(value['id']) or not valid_uuid(value['reward_id']):
        raise ValueError('mapping_invalid')
    if type(value['version']) is not int or not 1 <= value['version'] <= 2147483647:
        raise ValueError('mapping_invalid')
    if value['source'] != source or value['branch_id'] != branch_id or (branch_id is not None and not valid_uuid(branch_id)):
        raise ValueError('mapping_scope')
    if not isinstance(value['product_ref'], str) or not re.fullmatch(r'product\.product:[1-9][0-9]{0,9}', value['product_ref']):
        raise ValueError('product_invalid')
    if value['item_kind'] not in ('product', 'service') or not isinstance(value['reward_name'], str) or not 1 <= len(value['reward_name']) <= 200:
        raise ValueError('mapping_invalid')
    if 'enabled' in value and type(value['enabled']) is not bool:
        raise ValueError('mapping_invalid')
    reward_quantity(value['quantity'])
    return {key: value[key] for key in sorted(required | ({'enabled'} if 'enabled' in value else set()))}


def reward_delivery_outcome(status, body, event_id, redemption_id):
    if status in (408, 425, 429) or status >= 500:
        return 'retry', 'http_retry'
    if status != 200:
        return 'review', 'http_rejected'
    if not isinstance(body, dict) or body.get('ok') is not True or body.get('eventId') != event_id or body.get('redemptionId') != redemption_id or body.get('status') not in ('recorded', 'review') or type(body.get('replay')) is not bool:
        return 'retry', 'unrecognized_response'
    return 'done', body['status']


def delivery_outcome(status, body, kind):
    if status in (408, 425, 429) or status >= 500:
        return 'retry', 'http_retry'
    if status != 200:
        return 'review', 'http_rejected'
    if not isinstance(body, dict) or body.get('ok') is not True:
        return 'retry', 'unrecognized_response'
    if kind == 'sale':
        result = body.get('result')
        if not isinstance(result, dict):
            return 'retry', 'unrecognized_response'
        if result.get('errors') or result.get('ignored'):
            return 'review', 'sale_not_applied'
        if result.get('awarded') == 1:
            return 'done', 'applied'
        if result.get('duplicates') == 1:
            return 'done', 'duplicate'
        return 'review', 'sale_not_applied'
    refund = body.get('refund')
    if not isinstance(refund, dict) or refund.get('status') not in ('pending', 'reconciled'):
        return 'retry', 'unrecognized_response'
    return ('done', 'refund_reconciled') if refund['status'] == 'reconciled' else ('review', 'refund_pending')
