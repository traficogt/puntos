import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

process.env.NODE_ENV = 'test';

test('Odoo package route serves only the pinned addon, with integrity and no business data', async () => {
  const { createOdooConnectorRoutes } = await import('../../src/app/routes/odoo-connector-routes.js');
  const app = express();
  app.use('/api', createOdooConnectorRoutes());
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const result = await fetch(`${origin}/api/public/integrations/odoo/18/pf_pos_connector.zip`);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /application\/zip/);
    assert.match(result.headers.get('content-disposition'), /pf_pos_connector-18\.0\.3\.0\.0\.zip/);
    const bytes = Buffer.from(await result.arrayBuffer());
    assert.deepEqual(bytes.subarray(0,4), Buffer.from([80,75,3,4]));
    assert.equal(result.headers.get('x-content-sha256'), crypto.createHash('sha256').update(bytes).digest('hex'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed fixture distribution path.
    assert.deepEqual(bytes, await readFile(new URL('../../integrations/odoo/dist/pf_pos_connector-18.0.3.0.0.zip', import.meta.url)));
    assert.equal((await fetch(`${origin}/api/public/integrations/odoo/19/pf_pos_connector.zip`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Python connector canonical sale bytes and HMAC agree with the actual PF authentication and normalizer', async () => {
  const { verifyPosCredentials, normalizePosSale } = await import('../../src/app/services/pos/common.js');
  const { normalizePosRefund } = await import('../../src/app/services/pos-refund-service.js');
  const rawBody = '{"amountQ":75.0,"currency":"GTQ","customerPhone":"50255554444","items":3,"saleId":"pos.order:7","source":"odoo:db:1:2","status":"paid"}';
  const signature = 'sha256=d403a6b9d2de999c5c4b1d0d8b99e3d717f6cee9f7e78c278ae93315fdc851ac';
  const business = { program_json:{ external_awards:{api_key:'fixture-secret', enabled:true}, pos_integration:{enabled:true} } };
  assert.doesNotThrow(() => verifyPosCredentials(business, {signature, rawBody}));
  assert.throws(() => verifyPosCredentials(business, {signature, rawBody:`${rawBody} `}));
  assert.equal(normalizePosSale(JSON.parse(rawBody)).items, 3);
  assert.deepEqual(normalizePosRefund({refundId:'pos.order:8',originalSaleId:'pos.order:7',source:'odoo:db:1:2',amountQ:75,currency:'GTQ',scope:'full'}), {refundId:'pos.order:8',originalSaleId:'pos.order:7',source:'odoo:db:1:2',amountQ:75,currency:'GTQ',scope:'full'});
});

test('Python reward event bytes authenticate in PF and preserve the separate stock observation contract', async () => {
  const { verifyPosCredentials } = await import('../../src/app/services/pos/common.js');
  const { normalizePosFulfillmentEvent } = await import('../../src/app/services/redemption-pos-model.js');
  const script = `import importlib.util,json
spec=importlib.util.spec_from_file_location('pf_core','integrations/odoo/pf_pos_connector/core.py')
core=importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
body=core.encode_payload(dict(eventId='pos.order.line:314:recorded',redemptionId='10000000-0000-4000-8000-000000000003',source='odoo:db:1:2',orderId='pos.order:101',lineId='pos.order.line:314',productRef='product.product:42',quantity=1.0,currency='GTQ',mappingId='10000000-0000-4000-8000-000000000001',mappingVersion=1,kind='recorded',stockStatus='pending',lineTotal=0))
print(json.dumps(dict(body=body,signature=core.signature('fixture-secret',body),endpoint=core.endpoint('https://pf.example','fixture','events'))))`;
  const wire = JSON.parse(execFileSync('python3', ['-c', script], { encoding:'utf8', cwd:new URL('../../', import.meta.url) }));
  const business = { program_json:{ external_awards:{api_key:'fixture-secret',enabled:true},pos_integration:{enabled:true} } };
  assert.doesNotThrow(() => verifyPosCredentials(business, { rawBody:wire.body, signature:wire.signature }));
  assert.equal(wire.endpoint, 'https://pf.example/api/public/pos/fixture/redemptions/events');
  const payload = JSON.parse(wire.body);
  assert.equal(payload.kind, 'recorded');
  assert.equal(payload.stockStatus, 'pending');
  assert.equal(payload.quantity, 1);
  assert.equal(payload.lineTotal, 0);
  assert.equal(Object.hasOwn(payload, 'customerPhone'), false);
  assert.deepEqual(normalizePosFulfillmentEvent(payload), payload);
  const reversal = {...payload, eventId:'pos.order.line:415:reversed', orderId:'pos.order:102', lineId:'pos.order.line:415', kind:'reversed',stockStatus:'returned',originalEventId:payload.eventId};
  const update = {...payload,eventId:`stock:${payload.eventId}:done`,kind:'stock_updated',stockStatus:'done',originalEventId:payload.eventId};
  assert.deepEqual(normalizePosFulfillmentEvent(reversal), reversal);
  assert.deepEqual(normalizePosFulfillmentEvent(update), update);
});

test('Odoo checkout and catalog wire payloads use the generic PF schemas', async () => {
  const checkout = await import('../../src/app/services/pos-checkout-model.js');
  const catalog = await import('../../src/app/services/merchant-catalog-model.js');
  const { normalizePosFulfillmentEvent } = await import('../../src/app/services/redemption-pos-model.js');
  const script = `import importlib.util,json
spec=importlib.util.spec_from_file_location('pf_core','integrations/odoo/pf_pos_connector/core.py')
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
source='odoo:fixture:1:2';request='10000000-0000-4000-8000-000000000005';branch='10000000-0000-4000-8000-000000000010'
base=dict(source=source,branchId=branch)
auth=dict(base,requestId=request,cartId='cart:1',cartLineId='line:1',customerId='10000000-0000-4000-8000-000000000004',customerQrToken='fixture-customer-qr-token',rewardId='10000000-0000-4000-8000-000000000002',mappingId='10000000-0000-4000-8000-000000000001',mappingVersion=1,operatorRef='res.users:7')
cancel=dict(base,requestId=request,cancelRequestId='10000000-0000-4000-8000-000000000006',cartId='cart:1',cartLineId='line:1',reason='Customer changed their mind',orderState='draft',rewardLineRemoved=True)
catalog=dict(source=source,requestId=request,observedAt='2026-11-11T00:00:00.000Z',items=[dict(productRef='product.product:42',sku=None,name='Coffee',itemKind='product',active=True)])
inventory=dict(base,requestId=request,observedAt='2026-11-11T00:00:00.000Z',items=[dict(productRef='product.product:42',availableQuantity=3.0)])
event=dict(eventId='line:42:recorded',redemptionId=request,source=source,orderId='pos.order:1',lineId='pos.order.line:42',productRef='product.product:42',quantity=1,currency='GTQ',mappingId=auth['mappingId'],mappingVersion=1,kind='recorded',stockStatus='pending',lineTotal=0,checkoutRequestId=request,cartId='cart:1',cartLineId='line:1')
print(core.encode_payload(dict(auth=auth,cancel=cancel,catalog=catalog,inventory=inventory,event=event,endpoints={key:core.endpoint('https://pf.example','fixture',key) for key in ('checkout_options','checkout_authorize','checkout_status','checkout_cancel','catalog_sync','inventory_snapshot')})))`;
  const wire = JSON.parse(execFileSync('python3', ['-c', script], { encoding:'utf8', cwd:new URL('../../', import.meta.url) }));
  assert.deepEqual(checkout.normalizeCheckoutAuthorize(wire.auth), wire.auth);
  assert.deepEqual(checkout.normalizeCheckoutCancel(wire.cancel), wire.cancel);
  assert.deepEqual(catalog.normalizeCatalogSync(wire.catalog), wire.catalog);
  assert.deepEqual(catalog.normalizeInventorySnapshot(wire.inventory), wire.inventory);
  assert.deepEqual(normalizePosFulfillmentEvent(wire.event), wire.event);
  assert.equal(wire.endpoints.checkout_authorize, 'https://pf.example/api/public/pos/fixture/checkout/authorize');
  assert.equal(wire.endpoints.inventory_snapshot, 'https://pf.example/api/public/pos/fixture/inventory/snapshot');
});
