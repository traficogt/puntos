import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentWebhook } from "../../src/app/services/payment-webhook-normalizer.js";
import { processPaymentWebhook } from "../../src/app/services/payment-webhook-service.js";
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
	  });
	});
