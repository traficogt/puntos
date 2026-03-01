import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { WebhookRepo } from "../repositories/webhook-repository.js";
import { logger } from "../../utils/logger.js";
import { resolveWebhookTarget } from "../../utils/webhook-url.js";
import { config } from "../../config/index.js";
import { decryptSecretMaybe } from "../../utils/secret-crypto.js";
import { emitBillingEvent } from "./billing-service.js";
import { withDbClientContext } from "../database.js";

function id() { return crypto.randomUUID(); }

function shouldSend(endpoint, event) {
  try {
    const events = typeof endpoint.events === "string" ? JSON.parse(endpoint.events) : endpoint.events;
    if (!Array.isArray(events)) return false;
    return events.includes("*") || events.includes(event);
  } catch {
    return false;
  }
}

function sign(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function sendPinnedWebhook({ url, body, headers, resolvedAddress, resolvedFamily, timeoutMs }) {
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers,
      lookup: (_hostname, _opts, cb) => cb(null, resolvedAddress, resolvedFamily || undefined)
    }, (res) => {
      res.resume();
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0 }));
    });

    req.setTimeout(timeoutMs, () => {
      const err = new Error("Timeout");
      err.name = "AbortError";
      req.destroy(err);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function enqueueWebhookEvent(businessId, event, payload) {
  const endpoints = await WebhookRepo.listEndpoints(businessId);
  for (const ep of endpoints) {
    if (!ep.active) continue;
    if (!shouldSend(ep, event)) continue;
    await WebhookRepo.enqueueDelivery({
      id: id(),
      endpoint_id: ep.id,
      event,
      payload: { event, payload, ts: new Date().toISOString() }
    });
  }
}

async function deliverOne(j) {
  try {
    const body = typeof j.payload === "string" ? j.payload : JSON.stringify(j.payload);
    const signingSecret = decryptSecretMaybe(j.secret);
    const sig = sign(signingSecret, body);

    const { url, resolvedAddress, resolvedFamily } = await resolveWebhookTarget(j.url, {
      requireHttps: config.WEBHOOK_REQUIRE_HTTPS,
      allowlist: config.WEBHOOK_ALLOWLIST
    });
    if (!resolvedAddress) {
      throw new Error("DNS lookup returned no addresses");
    }

    const resp = await sendPinnedWebhook({
      url,
      resolvedAddress,
      resolvedFamily,
      timeoutMs: config.WEBHOOK_TIMEOUT_MS,
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Puntos-Event": j.event,
        "X-Puntos-Signature": sig
      }
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) throw new Error(`HTTP ${resp.statusCode}`);
    await withDbClientContext({ tenantId: j.business_id, platformAdmin: false }, async () => {
      await WebhookRepo.markSent(j.id);
      await emitBillingEvent({ businessId: j.business_id, eventType: "webhook.sent", amount: 1, unit: "count", metadata: { event: j.event } });
    });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Timeout" : (e?.message ?? String(e));
    logger.warn({ id: j.id, err: msg }, "Webhook delivery failed");
    await withDbClientContext({ tenantId: j.business_id, platformAdmin: false }, async () => {
      await WebhookRepo.recordFailure(j.id, msg, config.WEBHOOK_MAX_ATTEMPTS);
      await emitBillingEvent({ businessId: j.business_id, eventType: "webhook.failed", amount: 1, unit: "count", metadata: { event: j.event, error: msg } });
    });
  }
}

async function mapLimit(items, limit, fn) {
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (items.length) {
      const item = items.shift();
      if (!item) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function deliverPendingOnce() {
  // Claim quickly under platform admin context, then release DB connection before doing network I/O.
  const jobs = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    return WebhookRepo.claimPending(25, config.WEBHOOK_MAX_ATTEMPTS);
  });
  if (!jobs.length) return;

  const concurrency = Math.max(1, Number(config.WEBHOOK_CONCURRENCY || 5));
  await mapLimit([...jobs], concurrency, deliverOne);
}
