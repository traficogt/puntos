import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { config } from "../../src/config/index.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { paymentWebhookRoutes } from "../../src/app/routes/payment-webhook-routes.js";

test("rejected payment webhook signatures are recorded through the privileged security writer", async () => {
  const original = {
    secrets: config.PAYMENT_WEBHOOK_SECRETS,
    log: SecurityEventRepo.log,
    logPrivileged: SecurityEventRepo.logPrivileged
  };
  const privileged = [];
  // Before the signature verifies there is no tenant, so a plain RLS insert
  // into security_events would be rejected and the event silently lost.
  SecurityEventRepo.log = async () => { throw new Error("plain RLS insert must not be used"); };
  SecurityEventRepo.logPrivileged = async (event) => { privileged.push(event); };
  config.PAYMENT_WEBHOOK_SECRETS = { ...(original.secrets || {}), cubo: "expected-secret" };

  const app = express();
  app.use(express.json());
  app.use(paymentWebhookRoutes);
  app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ error: err.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
    const res = await fetch(`http://127.0.0.1:${port}/public/payments/webhook/cubo`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "wrong-secret" },
      body: JSON.stringify({ id: "evt-1" })
    });
    assert.equal(res.status, 403);
    assert.equal(privileged.length, 1);
    assert.equal(privileged[0].event_type, "webhook_auth_failed");
    assert.equal(privileged[0].actor_type, "ANON");
    assert.equal(privileged[0].meta.provider, "cubo");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    config.PAYMENT_WEBHOOK_SECRETS = original.secrets;
    SecurityEventRepo.log = original.log;
    SecurityEventRepo.logPrivileged = original.logPrivileged;
  }
});
