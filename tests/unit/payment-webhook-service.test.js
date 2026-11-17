import {runWithDbContext} from '../../src/app/database.js';
import {BusinessRepo} from '../../src/app/repositories/business-repository.js';
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentWebhook } from "../../src/app/services/payment-webhook-normalizer.js";
import { processPaymentWebhook, resolvePaymentWebhookEventForBusiness } from "../../src/app/services/payment-webhook-service.js";
import { config } from "../../src/config/index.js";

describe("payment-webhook-service", () => {
  it("normalizes payload into consistent shape", () => {
    const out = normalizePaymentWebhook("cubo", {
      transaction_id: "tx123",
      status: "PAID",
      amount: "10.5",
      currency: "GTQ",
      metadata: { businessSlug: "cafecito", customerPhone: "+50212345678" }
    });
    assert.equal(out.provider, "cubo");
    assert.equal(out.providerEventId, "tx123");
    assert.equal(out.eventType, "payment.approved");
    assert.equal(out.businessSlug, "cafecito");
    assert.equal(out.customerPhone, "+50212345678");
    assert.equal(out.amount_q, 10.5);
  });

  it("rejects when auth is required but no provider secrets are configured", async () => {
    const previousRequireAuth = config.PAYMENT_WEBHOOK_REQUIRE_AUTH;
    const previousSecrets = config.PAYMENT_WEBHOOK_SECRETS;
    const previousHmacSecrets = config.PAYMENT_WEBHOOK_HMAC_SECRETS;
    try {
      // Force auth requirement with empty secrets to ensure guard triggers before DB work
      config.PAYMENT_WEBHOOK_REQUIRE_AUTH = true;
      config.PAYMENT_WEBHOOK_SECRETS = {};
      config.PAYMENT_WEBHOOK_HMAC_SECRETS = {};
	    await assert.rejects(
	      () => processPaymentWebhook({
	        provider: "cubo",
	        payload: { transaction_id: "tx999" },
	        secretHeader: "",
	        signatureHeader: "",
	        rawBody: "{}"
	      }),
	      (err) => {
	        const e = /** @type {any} */ (err);
	        assert.equal(e?.statusCode ?? e?.status, 403);
	        return true;
	      }
	    );
    } finally {
      config.PAYMENT_WEBHOOK_REQUIRE_AUTH = previousRequireAuth;
      config.PAYMENT_WEBHOOK_SECRETS = previousSecrets;
      config.PAYMENT_WEBHOOK_HMAC_SECRETS = previousHmacSecrets;
    }
	  });
  it("does not treat x-signature as a static provider secret", async () => {
    const previousRequireAuth = config.PAYMENT_WEBHOOK_REQUIRE_AUTH;
    const previousSecrets = config.PAYMENT_WEBHOOK_SECRETS;
    const previousHmacSecrets = config.PAYMENT_WEBHOOK_HMAC_SECRETS;

    try {
      config.PAYMENT_WEBHOOK_REQUIRE_AUTH = true;
      config.PAYMENT_WEBHOOK_SECRETS = { cubo: "static-secret-123" };
      config.PAYMENT_WEBHOOK_HMAC_SECRETS = {};

      await assert.rejects(
        () => processPaymentWebhook({
          provider: "cubo",
          payload: { transaction_id: "tx-x-signature-only" },
          secretHeader: "",
          signatureHeader: "static-secret-123",
          rawBody: "{}"
        }),
        (err) => {
          const e = /** @type {any} */ (err);
          assert.equal(e?.statusCode ?? e?.status, 403);
          assert.match(String(e?.message || ""), /Invalid provider webhook secret/);
          return true;
        }
      );
    } finally {
      config.PAYMENT_WEBHOOK_REQUIRE_AUTH = previousRequireAuth;
      config.PAYMENT_WEBHOOK_SECRETS = previousSecrets;
      config.PAYMENT_WEBHOOK_HMAC_SECRETS = previousHmacSecrets;
    }
  });
});

it('hands off normalized and stored payment currency without changing replay metadata',async t=>{
  const previous=config.PAYMENT_WEBHOOK_REQUIRE_AUTH;config.PAYMENT_WEBHOOK_REQUIRE_AUTH=false;
  t.mock.method(BusinessRepo,'getPublicBySlug',async()=>({id:'business-fixture'}));
  let event={id:'event-fixture',status:'RECEIVED',event_type:'payment.approved',business_slug:'fixture',business_id:'business-fixture',provider:'cubo',provider_event_id:'fixture-event',currency:'USD',amount_q:10};
  const client={query:async(sql)=>({rows:sql.includes('payment_webhook_events')&&!sql.trim().startsWith('UPDATE')?[event]:[],rowCount:1})};
  const awards=[];const dependencies={award:async input=>{awards.push(input);return{ok:true,transactionId:'transaction-fixture',customerId:'customer-fixture',pointsAwarded:10,status:'POSTED',availableAt:null,replay:false};}};
  try{
    await runWithDbContext({client,tenantId:null,platformAdmin:false},()=>processPaymentWebhook({provider:'cubo',payload:{transaction_id:'fixture-event',status:'PAID',amount:10,currency:'USD',metadata:{businessSlug:'fixture',customerId:'customer-fixture'}},secretHeader:undefined},dependencies));
    assert.equal(awards[0].expectedCurrency,'USD');assert.equal(awards[0].meta.currency,'USD');
    event={...event,status:'PENDING_MAPPING'};
    await runWithDbContext({client,tenantId:'business-fixture',platformAdmin:false},()=>resolvePaymentWebhookEventForBusiness({businessId:'business-fixture',eventId:'event-fixture',customerId:'customer-fixture',customerPhone:undefined},dependencies));
    assert.equal(awards[1].expectedCurrency,'USD');assert.deepEqual(awards[1].meta,{provider:'cubo',payment_event_id:'fixture-event',resolved_manually:true});
  }finally{config.PAYMENT_WEBHOOK_REQUIRE_AUTH=previous;}
});

function eventStore(initial) {
  const state = { event: initial ? { ...initial } : null, inserted: [], updates: [] };
  const client = {
    query: async (sql, params = []) => {
      const text = sql.trim();
      if (text.startsWith('INSERT INTO payment_webhook_events')) {
        state.inserted.push(params);
        if (state.event) return { rows: [] };
        state.event = { id: params[0], provider: params[1], provider_event_id: params[2], event_type: params[3], business_slug: params[4], business_id: params[5], customer_id: params[6], customer_phone: params[7], amount_q: params[8], currency: params[9], status: 'RECEIVED', reason: null };
        return { rows: [{ ...state.event }] };
      }
      if (text.startsWith('SELECT') && text.includes('payment_webhook_events')) return { rows: state.event ? [{ ...state.event }] : [] };
      if (text.startsWith('UPDATE payment_webhook_events')) {
        const [, setStatus, status, setReason, reason, , , , , , , , , setAmount, amount] = params;
        state.updates.push({ status: setStatus ? status : undefined, reason: setReason ? reason : undefined, amount: setAmount ? amount : undefined });
        Object.assign(state.event, setStatus ? { status } : {}, setReason ? { reason } : {}, setAmount ? { amount_q: amount } : {});
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  return { state, client };
}

describe('payment webhook amounts and manual resolution', () => {
  const pending = { id: 'event-1', provider: 'cubo', provider_event_id: 'evt-1', event_type: 'payment.approved', business_slug: 'fixture', business_id: 'business-fixture', currency: 'GTQ', amount_q: '40.00', status: 'PENDING_MAPPING', reason: 'missing_customer_mapping' };
  const withAuthOff = async (t, fn) => {
    const previous = config.PAYMENT_WEBHOOK_REQUIRE_AUTH; config.PAYMENT_WEBHOOK_REQUIRE_AUTH = false;
    t.mock.method(BusinessRepo, 'getPublicBySlug', async () => ({ id: 'business-fixture' }));
    try { return await fn(); } finally { config.PAYMENT_WEBHOOK_REQUIRE_AUTH = previous; }
  };
  const deliver = (client, payload, award) => runWithDbContext({ client, tenantId: null, platformAdmin: false }, () => processPaymentWebhook({ provider: 'cubo', secretHeader: undefined, payload: { transaction_id: 'evt-1', status: 'PAID', metadata: { businessSlug: 'fixture', customerPhone: '50255554444' }, ...payload } }, { award }));
  /** @param {any} client @param {Record<string, unknown>} input @param {any} award */
  const resolve = (client, input, award) => runWithDbContext({ client, tenantId: 'business-fixture', platformAdmin: false }, () => resolvePaymentWebhookEventForBusiness({ businessId: 'business-fixture', eventId: 'event-1', customerId: undefined, customerPhone: '50255554444', ...input }, { award }));

  for (const amount of [undefined, 'abc', true, '', '12,50', -1]) {
    it(`never applies a paid event with amount ${JSON.stringify(amount)} as zero, and a corrected redelivery applies it`, async (t) => withAuthOff(t, async () => {
      const { state, client } = eventStore(null);
      const awards = [];
      const award = async (input) => { awards.push(input); return { transactionId: 'tx-1', customerId: 'customer-1' }; };
      await assert.rejects(deliver(client, { amount }, award), { statusCode: 400 });
      assert.equal(awards.length, 0);
      assert.equal(state.event.status, 'FAILED');
      assert.equal(state.event.reason, 'invalid_amount');
      assert.equal(state.inserted[0][8], 0);
      const out = await deliver(client, { amount: '25.50' }, award);
      assert.equal(out.applied, true);
      assert.equal(awards[0].amount_q, 25.5);
      assert.equal(state.event.status, 'APPLIED');
      assert.equal(state.event.amount_q, 25.5);
      // The applied event is now a duplicate for later redeliveries.
      assert.equal((await deliver(client, { amount: '25.50' }, award)).duplicate, true);
      assert.equal(awards.length, 1);
    }));
  }

  for (const [label, patch] of /** @type {Array<[string, Record<string, unknown>]>} */ ([
    ['an ignored refund', { status: 'IGNORED', reason: 'non_approved_event', event_type: 'payment.other' }],
    ['an ignored pending payment', { status: 'IGNORED', reason: 'non_approved_event' }],
    ['an applied payment', { status: 'APPLIED', reason: null }],
    ['a payment still being received', { status: 'RECEIVED', reason: null }],
    ['a failed award', { status: 'FAILED', reason: 'award_failed' }],
    ['a non-approved pending event', { event_type: 'payment.other' }]
  ])) {
    it(`does not let a manager credit ${label}`, async () => {
      const { state, client } = eventStore({ ...pending, ...patch });
      let awarded = 0;
      await assert.rejects(resolve(client, {}, async () => { awarded += 1; return { transactionId: 'tx' }; }), { statusCode: 409 });
      assert.equal(awarded, 0);
      assert.equal(state.updates.length, 0);
    });
  }

  it('credits a payment pending customer mapping with its recorded amount', async () => {
    const { state, client } = eventStore(pending);
    const awards = [];
    await resolve(client, {}, async (input) => { awards.push(input); return { transactionId: 'tx-1', customerId: 'customer-1' }; });
    assert.equal(awards[0].amount_q, 40);
    assert.equal(state.event.status, 'APPLIED');
    await assert.rejects(resolve(client, { amountQ: 50 }, async () => ({})), { statusCode: 409 });
  });

  it('rejects an amount correction for an event whose amount was valid', async () => {
    const { client } = eventStore(pending);
    await assert.rejects(resolve(client, { amountQ: 50 }, async () => ({})), { statusCode: 400 });
  });

  it('requires a valid corrected amount to credit an event that arrived without one', async () => {
    const { state, client } = eventStore({ ...pending, status: 'FAILED', reason: 'invalid_amount', amount_q: '0.00' });
    const awards = [];
    const award = async (input) => { awards.push(input); return { transactionId: 'tx-1', customerId: 'customer-1' }; };
    await assert.rejects(resolve(client, {}, award), { statusCode: 400 });
    await assert.rejects(resolve(client, { amountQ: 'abc' }, award), { statusCode: 400 });
    await assert.rejects(resolve(client, { amountQ: true }, award), { statusCode: 400 });
    assert.equal(awards.length, 0);
    await resolve(client, { amountQ: '18.75' }, award);
    assert.equal(awards[0].amount_q, 18.75);
    assert.equal(state.event.status, 'APPLIED');
    assert.equal(state.event.amount_q, 18.75);
  });
});
