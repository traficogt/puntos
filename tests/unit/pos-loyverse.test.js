import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchLoyverseSales, fetchLoyverseSalesByReceiptIds, verifyLoyverseConnection } from "../../src/app/services/pos/loyverse.js";

const TOKEN = "private-loyverse-token-do-not-expose";
const SINCE = "2026-11-09T00:00:00.000Z";
const UNTIL = "2026-11-09T01:00:00.000Z";
const merchant = { id: "merchant-1", business_name: "La Tienda", currency: { code: "GTQ", decimal_places: 2 } };
const customer = { id: "foreign-customer-id", phone_number: "+502 5555-1234" };

function receipt(overrides = {}) {
  return {
    receipt_number: "2-1008", receipt_type: "SALE", store_id: "store-1",
    customer_id: customer.id, total_money: 17.52, cancelled_at: null, refund_for: null,
    created_at: "2026-11-09T00:15:00.000Z", receipt_date: "2026-11-09T00:15:00.000Z",
    line_items: [{ item_id: "item-1", variant_id: "variant-1", quantity: 2 }, { item_id: "item-2", variant_id: "variant-2", quantity: 1 }],
    payments: [{ payment_type_id: "cash", money_amount: 17.52, paid_at: "2026-11-09T00:15:00.000Z" }],
    ...overrides
  };
}

/** @param {{receipts?: any, customers?: any, profile?: any, cursor?: any, store?: any, originals?: any}} [options] */
function mockApi({ receipts = [receipt()], customers = [customer], profile = merchant, cursor = null, store = { id: "store-1" }, originals = [receipt({ receipt_number: "2-1000" })] } = {}) {
  const requests = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    assert.equal(url.origin, "https://api.loyverse.com");
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.method, "GET");
    if (url.pathname.startsWith("/v1.0/receipts/")) {
      const found = [...receipts, ...originals].find((record) => record?.receipt_number === decodeURIComponent(url.pathname.split("/").at(-1)));
      return found ? Response.json(found) : Response.json({ errors: [{ code: "NOT_FOUND" }] }, { status: 404 });
    }
    const bodies = {
      "/v1.0/merchant/": profile,
      "/v1.0/stores/store-1": store,
      "/v1.0/receipts": { receipts, cursor },
      "/v1.0/customers": { customers }
    };
    assert.ok(Object.hasOwn(bodies, url.pathname), `Unexpected endpoint: ${url.pathname}`);
    return Response.json(bodies[url.pathname]);
  };
  return { fetchImpl, requests };
}

function fetchPage(api, overrides = {}) {
  return fetchLoyverseSales({ accessToken: TOKEN, merchantId: merchant.id, since: SINCE, until: UNTIL, fetchImpl: api.fetchImpl, ...overrides });
}

/** @param {any} api @param {any} [receiptIds] @param {Record<string, any>} [overrides] */
function fetchReceipts(api, receiptIds = ["2-1008"], overrides = {}) {
  return fetchLoyverseSalesByReceiptIds({ accessToken: TOKEN, merchantId: merchant.id, receiptIds, fetchImpl: api.fetchImpl, ...overrides });
}

testRefundReceipts();
function testRefundReceipts() {
  it("emits native refund evidence without resolving or guessing a customer", async () => {
    const api = mockApi({ receipts: [receipt({ receipt_type: "REFUND", refund_for: "2-1000", customer_id: null })] });
    const result = await fetchPage(api);
    const { nativeEvidence, ...contract } = result.refunds[0];
    assert.match(nativeEvidence, /^[a-f0-9]{64}$/);
    assert.deepEqual(contract, { refundId: "2-1008", originalSaleId: "2-1000", source: "loyverse:merchant-1:store-1", amountQ: 17.52, currency: "GTQ", scope: "full" });
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(api.requests.some(({ url }) => url.pathname === "/v1.0/customers"), false);
  });
  it("refund evidence requires original receipt, selected store, exact cents and reconciled payment", async () => {
    const variations = [{ refund_for: null }, { refund_for: "2-1008" }, { store_id: "other-store" }, { total_money: 1.001 }, { payments: [] }, { cancelled_at: SINCE }];
    for (const patch of variations) {
      const result = await fetchPage(mockApi({ receipts: [receipt({ receipt_type: "REFUND", refund_for: "2-1000", ...patch })] }), { storeId: "store-1" });
      assert.equal(result.refunds?.length ?? 0, 0);
      assert.equal(result.issues.length, 1);
      assert.equal(result.sales.length, 0);
    }
  });
  it("receipt-ID retries preserve refunds as refunds", async () => {
    const result = await fetchReceipts(mockApi({ receipts: [receipt({ receipt_type: "REFUND", refund_for: "2-1000" })] }));
    assert.equal(result.refunds?.length, 1);
    assert.equal(result.refunds[0].originalSaleId, "2-1000");
  });
  it("free items and partial quantities cannot be mistaken for full refunds with equal totals", async () => {
    for (const line_items of [[{ item_id: "item-1", variant_id: "variant-1", quantity: 2 }], [{ item_id: "item-1", variant_id: "variant-1", quantity: 1 }, { item_id: "item-2", variant_id: "variant-2", quantity: 1 }]]) {
      const result = await fetchPage(mockApi({ receipts: [receipt({ receipt_type: "REFUND", refund_for: "2-1000", line_items })] }));
      assert.equal(result.refunds[0].scope, "partial");
    }
  });
  it("missing original, wrong store and unknown item identity keep refund scope unverified", async () => {
    for (const originals of [[], [receipt({ receipt_number: "2-1000", store_id: "another-store" })], [receipt({ receipt_number: "2-1000", line_items: [{ quantity: 3 }] })]]) {
      const result = await fetchPage(mockApi({ receipts: [receipt({ receipt_type: "REFUND", refund_for: "2-1000" })], originals }));
      assert.equal(result.refunds[0].scope, "unknown");
      assert.equal(result.sales.length, 0);
    }
  });
}

describe("Loyverse connection verification", () => {
  it("verifies the official merchant profile and optional store identity", async () => {
    const api = mockApi();
    const result = await verifyLoyverseConnection({ accessToken: TOKEN, storeId: "store-1", fetchImpl: api.fetchImpl });
    assert.deepEqual(result, { merchantId: merchant.id, merchantName: "La Tienda", currency: "GTQ", storeId: "store-1" });
    assert.deepEqual(api.requests.map(({ url }) => url.pathname), ["/v1.0/merchant/", "/v1.0/stores/store-1"]);
  });

  it("allows merchant-wide receipts without silently selecting a store", async () => {
    const api = mockApi();
    const result = await verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl: api.fetchImpl });
    assert.equal(result.storeId, null);
    assert.equal(api.requests.length, 1);
  });

  it("rejects unsupported currency and undocumented currency shapes", async () => {
    for (const currency of [{ code: "USD" }, "GTQ", null, { code: "GTQ", decimal_places: 0 }]) {
      const api = mockApi({ profile: { ...merchant, currency } });
      await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl: api.fetchImpl }), /GTQ|moneda/i);
    }
  });

  it("rejects missing merchant identity and deleted or mismatched stores", async () => {
    await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl: mockApi({ profile: { ...merchant, id: "" } }).fetchImpl }), /comercio/i);
    for (const store of [{ id: "other-store" }, { id: "store-1", deleted_at: SINCE }]) {
      await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, storeId: "store-1", fetchImpl: mockApi({ store }).fetchImpl }), /tienda/i);
    }
  });

  it("rejects arbitrary endpoint-like store IDs before making requests", async () => {
    const api = mockApi();
    await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, storeId: "https://evil.example/", fetchImpl: api.fetchImpl }), /tienda/i);
    assert.equal(api.requests.length, 0);
  });
});

describe("Loyverse bounded receipt polling", () => {
  it("resolves customer phones, preserves major-unit money and produces stable namespaced sales", async () => {
    const api = mockApi();
    const result = await fetchPage(api);
    assert.deepEqual(result, {
      sales: [{ saleId: "2-1008", source: "loyverse:merchant-1:store-1", customerPhone: "50255551234", amountQ: 17.52, currency: "GTQ", visits: 1, items: 3, occurredAt: "2026-11-09T00:15:00.000Z" }],
      issues: [], nextCursor: null
    });
    assert.equal(Object.hasOwn(result.sales[0], "customerId"), false);
    assert.deepEqual(await fetchPage(mockApi()), result);
    const request = api.requests.find(({ url }) => url.pathname === "/v1.0/customers");
    assert.equal(request.url.searchParams.get("customer_ids"), customer.id);
    assert.equal(request.url.searchParams.get("limit"), "100");
  });

  it("uses the fixed window, selected store, opaque cursor and limit of 100", async () => {
    const api = mockApi({ cursor: "next-page" });
    const result = await fetchPage(api, { storeId: "store-1", cursor: "https://evil.example/?x=1&y=2" });
    const request = api.requests.find(({ url }) => url.pathname === "/v1.0/receipts");
    assert.equal(request.url.searchParams.get("updated_at_min"), SINCE);
    assert.equal(request.url.searchParams.get("updated_at_max"), UNTIL);
    assert.equal(request.url.searchParams.get("store_id"), "store-1");
    assert.equal(request.url.searchParams.get("cursor"), "https://evil.example/?x=1&y=2");
    assert.equal(request.url.searchParams.get("limit"), "100");
    assert.equal(result.nextCursor, "next-page");
  });

  it("refuses to synchronize a different merchant even if its currency is GTQ", async () => {
    const api = mockApi({ profile: { ...merchant, id: "another-merchant" } });
    await assert.rejects(() => fetchPage(api), /comercio/i);
    assert.equal(api.requests.some(({ url }) => url.pathname === "/v1.0/receipts"), false);
  });

  it("rejects invalid dates and reversed windows before any API request", async () => {
    for (const input of [{ since: "" }, { since: "not-a-date" }, { since: UNTIL, until: SINCE }, { until: undefined }]) {
      const api = mockApi();
      await assert.rejects(() => fetchPage(api, input), /fecha|período/i);
      assert.equal(api.requests.length, 0);
    }
  });

  it("returns actionable issues for refunds, cancellations, unknown types and missing receipt identity", async () => {
    const api = mockApi({ receipts: [
      receipt({ receipt_type: "REFUND" }), receipt({ cancelled_at: SINCE }),
      receipt({ refund_for: "2-1000" }), receipt({ receipt_type: "PAID" }),
      receipt({ receipt_type: undefined }), receipt({ receipt_number: undefined }), null
    ] });
    const result = await fetchPage(api);
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues.length, 7);
    assert.ok(result.issues.every((issue) => typeof issue.message === "string" && issue.message.length > 10 && issue.code));
    assert.equal(api.requests.some(({ url }) => url.pathname === "/v1.0/customers"), false);
  });

  it("does not emit an unqueryable receipt ID into the recovery queue", async () => {
    const result = await fetchPage(mockApi({ receipts: [receipt({ receipt_number: "https://invalid.example/receipt" })] }));
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues[0].code, "invalid_receipt");
    assert.equal(result.issues[0].saleId, "");
  });

  it("rejects malformed, negative, nonfinite and nonnumeric major amounts", async () => {
    const amounts = [undefined, null, "17.52", "", true, {}, -1, Number.NaN, Number.POSITIVE_INFINITY];
    const result = await fetchPage(mockApi({ receipts: amounts.map((total_money) => receipt({ total_money })) }));
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues.length, amounts.length);
    assert.ok(result.issues.every((issue) => issue.code === "invalid_amount"));
  });

  it("requires complete paid receipts with payment totals that reconcile", async () => {
    const payments = [undefined, [], [{ payment_type_id: "cash", money_amount: 1 }], [{ money_amount: 17.52 }], [{ payment_type_id: "cash", money_amount: "17.52" }], [{ payment_type_id: "cash", money_amount: -17.52 }]];
    const result = await fetchPage(mockApi({ receipts: payments.map((value) => receipt({ payments: value })) }));
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues.length, payments.length);
    assert.ok(result.issues.every((issue) => issue.code === "unverified_payment"));
  });

  it("accepts split payments and zero-value completed sales", async () => {
    const result = await fetchPage(mockApi({ receipts: [
      receipt({ payments: [{ payment_type_id: "cash", money_amount: 10, paid_at: SINCE }, { payment_type_id: "card", money_amount: 7.52, paid_at: SINCE }] }),
      receipt({ receipt_number: "2-1009", total_money: 0, payments: [{ payment_type_id: "cash", money_amount: 0, paid_at: SINCE }] })
    ] }));
    assert.equal(result.sales.length, 2);
    assert.equal(result.issues.length, 0);
    assert.equal(result.sales[1].amountQ, 0);
  });

  it("accepts documented required payment fields without requiring the optional paid_at field", async () => {
    const result = await fetchPage(mockApi({ receipts: [receipt({ payments: [{ payment_type_id: "cash", money_amount: 17.52 }] })] }));
    assert.equal(result.sales.length, 1);
    assert.equal(result.issues.length, 0);
  });

  it("does not award a receipt outside the selected store", async () => {
    const result = await fetchPage(mockApi({ receipts: [receipt({ store_id: "other-store" }), receipt({ store_id: undefined })] }), { storeId: "store-1" });
    assert.equal(result.sales.length, 0);
    assert.equal(result.issues.length, 2);
  });

  it("reports anonymous customers, missing customer records and missing or malformed phones", async () => {
    const receipts = [receipt({ customer_id: null }), receipt({ customer_id: "missing" }), receipt({ customer_id: "no-phone" }), receipt({ customer_id: "bad-phone" })];
    const customers = [{ id: "no-phone", phone_number: null }, { id: "bad-phone", phone_number: "customer-id-123" }];
    const result = await fetchPage(mockApi({ receipts, customers }));
    assert.equal(result.sales.length, 0);
    assert.deepEqual(result.issues.map((issue) => issue.code), ["missing_customer", "customer_not_found", "missing_phone", "invalid_phone"]);
  });

  it("resolves shared customers once and does not substitute a different returned customer", async () => {
    const api = mockApi({ receipts: [receipt(), receipt({ receipt_number: "2-1009" })] });
    const result = await fetchPage(api);
    assert.equal(result.sales.length, 2);
    assert.equal(api.requests.filter(({ url }) => url.pathname === "/v1.0/customers").length, 1);
    const wrongCustomer = await fetchPage(mockApi({ customers: [{ id: "some-other-id", phone_number: customer.phone_number }] }));
    assert.equal(wrongCustomer.sales.length, 0);
    assert.equal(wrongCustomer.issues[0].code, "customer_not_found");
  });

  it("keeps fractional quantities out of integer item rewards and rejects invalid quantities", async () => {
    const result = await fetchPage(mockApi({ receipts: [
      receipt({ line_items: [{ quantity: 0.5 }] }),
      receipt({ line_items: [{ quantity: -1 }] }),
      receipt({ line_items: [{ quantity: "2" }] })
    ] }));
    assert.equal(result.sales.length, 1);
    assert.equal(result.sales[0].items, 0);
    assert.equal(result.issues.length, 2);
  });

  it("rejects oversized or malformed receipt pages rather than silently truncating them", async () => {
    for (const receipts of [Array.from({ length: 101 }, () => receipt()), null, {}]) {
      await assert.rejects(() => fetchPage(mockApi({ receipts })), /respuesta|límite/i);
    }
  });

  it("rejects malformed and looping receipt cursors", async () => {
    await assert.rejects(() => fetchPage(mockApi({ cursor: { url: "https://evil.example/" } })), /cursor|respuesta/i);
    await assert.rejects(() => fetchPage(mockApi({ cursor: "same-cursor" }), { cursor: "same-cursor" }), /cursor/i);
  });
});

describe("Loyverse safe transport failures", () => {
  it("sanitizes authorization, rate limit, redirect and server errors without reading their bodies", async () => {
    for (const status of [401, 403, 429, 302, 500]) {
      let read = false;
      const fetchImpl = async () => ({ ok: false, status, json: async () => { read = true; return { token: TOKEN }; } });
      await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl }), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(String(error).includes(TOKEN), false);
        assert.match(error.message, /Loyverse/);
        assert.equal(error.cause, undefined);
        return true;
      });
      assert.equal(read, false);
    }
  });

  it("sanitizes network and JSON parsing errors", async () => {
    for (const fetchImpl of [async () => { throw new Error(TOKEN); }, async () => new Response(`invalid-json-${TOKEN}`)]) {
      await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl }), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(String(error).includes(TOKEN), false);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  });

  it("applies a ten-second request timeout and sanitizes its abort reason", async (t) => {
    let configuredTimeout = 0;
    t.mock.method(AbortSignal, "timeout", (milliseconds) => {
      configuredTimeout = milliseconds;
      return AbortSignal.abort(new Error(TOKEN));
    });
    const fetchImpl = async (_url, options) => options.signal.throwIfAborted();
    await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl }), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(String(error).includes(TOKEN), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(configuredTimeout, 10_000);
  });

  it("does not advance receipt pagination when the customer API is unavailable", async () => {
    const api = mockApi({ cursor: "next-page" });
    const fetchImpl = async (url, options) => String(url).includes("/customers?")
      ? { ok: false, status: 503, json: async () => ({ token: TOKEN }) }
      : api.fetchImpl(url, options);
    await assert.rejects(() => fetchPage({ fetchImpl }), /Loyverse/);
  });

  it("refuses malformed or incomplete customer responses instead of skipping them", async () => {
    for (const response of [{}, { customers: null }, { customers: [customer], cursor: "more-customers" }, { customers: [customer, { ...customer, phone_number: "55558888" }] }]) {
      const api = mockApi({ cursor: "next-page" });
      const fetchImpl = async (url, options) => String(url).includes("/customers?")
        ? Response.json(response)
        : api.fetchImpl(url, options);
      await assert.rejects(() => fetchPage({ fetchImpl }), /respuesta|clientes/i);
    }
  });

  it("rejects missing and malformed access tokens before requests", async () => {
    for (const accessToken of [undefined, "", "token\r\nInjected: yes"]) {
      const api = mockApi();
      await assert.rejects(() => verifyLoyverseConnection({ accessToken, fetchImpl: api.fetchImpl }), /token/i);
      assert.equal(api.requests.length, 0);
    }
  });

  it("rejects an oversized declared response before reading its body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(merchant))); },
      pull(controller) { controller.close(); },
      cancel() { cancelled = true; }
    });
    const fetchImpl = async () => new Response(body, { headers: { "content-length": String(6 * 1024 * 1024) } });
    await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl }), /tamaño|límite/i);
    assert.equal(cancelled, true);
  });

  it("caps streamed response bytes even without a trustworthy Content-Length", async () => {
    for (const length of [undefined, "1"]) {
      const chunks = [
        new TextEncoder().encode(`${JSON.stringify(merchant).slice(0, -1)},"extra":"`),
        ...Array.from({ length: 8 }, () => new TextEncoder().encode("a".repeat(1024 * 1024))),
        new TextEncoder().encode('"}')
      ];
      let read = 0;
      let cancelled = false;
      const body = new ReadableStream({
        pull(controller) {
          if (read === chunks.length) controller.close();
          else controller.enqueue(chunks[read++]);
        },
        cancel() { cancelled = true; }
      });
      const fetchImpl = async () => new Response(body, { headers: length ? { "content-length": length } : {} });
      await assert.rejects(() => verifyLoyverseConnection({ accessToken: TOKEN, fetchImpl }), /tamaño|límite/i);
      assert.equal(cancelled, true);
      assert.ok(read < chunks.length, "Stops consuming an oversized response stream");
    }
  });

  it("sanitizes response-stream failures without advancing receipt pagination", async () => {
    const api = mockApi({ cursor: "next-page" });
    const fetchImpl = async (url, options) => String(url).includes("/customers?")
      ? new Response(new ReadableStream({ start(controller) { controller.error(new Error(TOKEN)); } }))
      : api.fetchImpl(url, options);
    await assert.rejects(() => fetchPage({ fetchImpl }), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(String(error).includes(TOKEN), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
});

describe("Loyverse receipt recovery", () => {
  it("loads documented individual receipts and re-resolves the customer's current phone", async () => {
    const api = mockApi({ receipts: [receipt(), receipt({ receipt_number: "2-1009" })], customers: [{ ...customer, phone_number: "55559999" }] });
    const result = await fetchReceipts(api, ["2-1008", "2-1009"]);
    assert.equal(result.sales.length, 2);
    assert.equal(result.issues.length, 0);
    assert.ok(result.sales.every((sale) => sale.customerPhone === "50255559999"));
    assert.deepEqual(result.sales.map((sale) => sale.saleId), ["2-1008", "2-1009"]);
    assert.equal(Object.hasOwn(result, "nextCursor"), false);
    assert.deepEqual(api.requests.map(({ url }) => url.pathname), ["/v1.0/merchant/", "/v1.0/receipts/2-1008", "/v1.0/receipts/2-1009", "/v1.0/customers"]);
  });

  it("returns a terminal receipt_not_found issue only for a receipt HTTP 404", async () => {
    const api = mockApi();
    const result = await fetchReceipts(api, ["missing", "2-1008"]);
    assert.equal(result.sales.length, 1);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].saleId, "missing");
    assert.equal(result.issues[0].code, "receipt_not_found");
  });

  it("validates the account and store before resolving any receipt IDs", async () => {
    const api = mockApi({ profile: { ...merchant, id: "other-merchant" } });
    await assert.rejects(() => fetchReceipts(api), /comercio/i);
    assert.equal(api.requests.length, 1);
    const validApi = mockApi();
    await fetchReceipts(validApi, ["2-1008"], { storeId: "store-1" });
    assert.equal(validApi.requests[1].url.pathname, "/v1.0/stores/store-1");
  });

  it("bounds recovery to 25 receipt IDs and rejects arbitrary URL-shaped IDs", async () => {
    for (const ids of [null, "2-1008", ["https://evil.example/"], Array.from({ length: 26 }, (_, i) => `2-${i}`)]) {
      const api = mockApi();
      await assert.rejects(() => fetchReceipts(api, ids), /recibos|recibo|25/i);
      assert.equal(api.requests.length, 0);
    }
    const records = Array.from({ length: 25 }, (_, i) => receipt({ receipt_number: `2-${i}` }));
    const result = await fetchReceipts(mockApi({ receipts: records }), records.map((record) => record.receipt_number));
    assert.equal(result.sales.length, 25);
  });

  it("deduplicates receipt IDs and returns the same stable sale as regular polling", async () => {
    const api = mockApi();
    const result = await fetchReceipts(api, ["2-1008", "2-1008"]);
    assert.deepEqual(result.sales, (await fetchPage(mockApi())).sales);
    assert.equal(api.requests.filter(({ url }) => url.pathname === "/v1.0/receipts/2-1008").length, 1);
  });

  it("rechecks cancellations, refunds, store ownership and anonymous customers", async () => {
    const records = [receipt({ receipt_number: "cancelled", cancelled_at: SINCE }), receipt({ receipt_number: "refund", receipt_type: "REFUND" }), receipt({ receipt_number: "other-store", store_id: "other-store" }), receipt({ receipt_number: "anonymous", customer_id: null })];
    const result = await fetchReceipts(mockApi({ receipts: records }), records.map((record) => record.receipt_number), { storeId: "store-1" });
    assert.equal(result.sales.length, 0);
    assert.deepEqual(result.issues.map((issue) => issue.code), ["invalid_refund", "cancelled", "store_mismatch", "missing_customer"]);
  });

  it("throws on transient lookup failures so the recovery queue is retained", async () => {
    for (const status of [401, 403, 429, 503]) {
      const api = mockApi();
      const fetchImpl = async (url, options) => String(url).includes("/receipts/")
        ? new Response(TOKEN, { status })
        : api.fetchImpl(url, options);
      await assert.rejects(() => fetchReceipts({ fetchImpl }), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(String(error).includes(TOKEN), false);
        return true;
      });
    }
  });

  it("rejects mismatched or malformed receipt identity instead of awarding or dropping the queued receipt", async () => {
    for (const body of [receipt({ receipt_number: "other-receipt" }), null, {}]) {
      const api = mockApi();
      const fetchImpl = async (url, options) => String(url).includes("/receipts/")
        ? Response.json(body)
        : api.fetchImpl(url, options);
      await assert.rejects(() => fetchReceipts({ fetchImpl }), /recibo|respuesta/i);
    }
  });

  it("returns no work for an empty recovery queue", async () => {
    const api = mockApi();
    assert.deepEqual(await fetchReceipts(api, []), { sales: [], issues: [] });
    assert.equal(api.requests.length, 0);
  });

  it("limits simultaneous receipt lookups to five", async () => {
    const records = Array.from({ length: 12 }, (_, i) => receipt({ receipt_number: `2-${i}` }));
    const api = mockApi({ receipts: records });
    let active = 0, peak = 0;
    const fetchImpl = async (url, options) => {
      if (!String(url).includes("/receipts/")) return api.fetchImpl(url, options);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      try { return await api.fetchImpl(url, options); }
      finally { active -= 1; }
    };
    const result = await fetchReceipts({ fetchImpl }, records.map((record) => record.receipt_number));
    assert.equal(result.sales.length, 12);
    assert.equal(peak, 5);
  });
});
