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

/**
 * POSTs once to the validated address. Redirects are never followed (Node's
 * http client does not), and DNS is not consulted again: hostname URLs dial the
 * pinned address, while IP-literal URLs dial the validated literal itself.
 */
export function sendPinnedWebhook({ url, body, headers, resolvedAddress, resolvedFamily, timeoutMs }) {
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const req = transport.request(url, {
      method: "POST",
      headers,
      // Node asks for every address when it may race IPv4/IPv6 (autoSelectFamily).
      lookup: (_hostname, options, cb) => {
        if (options?.all) cb(null, [{ address: resolvedAddress, family: resolvedFamily || 4 }]);
        else cb(null, resolvedAddress, resolvedFamily || 4);
      }
    }, (res) => {
      res.resume();
      res.on("end", () => finish(resolve, { statusCode: res.statusCode ?? 0 }));
      res.on("error", (error) => finish(reject, error));
    });
    const abort = () => {
      const err = new Error("Timeout");
      err.name = "AbortError";
      req.destroy(err);
      finish(reject, err);
    };
    // setTimeout on the request is an idle timeout; the deadline also bounds a
    // receiver that keeps the connection busy, so a claim cannot outlive its lease.
    deadline = setTimeout(abort, timeoutMs);
    req.setTimeout(timeoutMs, abort);
    req.on("error", (error) => finish(reject, error));
    req.write(body);
    req.end();
  });
}

/** @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>} */
function withDeadline(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * A claimed batch is delivered `concurrency` at a time; each delivery is bounded
 * by the DNS deadline plus the HTTP deadline. The lease covers the whole batch
 * with margin so a live worker's claims are not reclaimed and sent twice.
 */
export function deliveryLeaseSeconds({ batchSize, concurrency, timeoutMs }) {
  const rounds = Math.ceil(Math.max(1, batchSize) / Math.max(1, concurrency));
  return Math.ceil(rounds * 2 * Math.max(1000, Number(timeoutMs) || 8000) / 1000) + 60;
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

    const { url, resolvedAddress, resolvedFamily } = await withDeadline(resolveWebhookTarget(j.url, {
      requireHttps: config.WEBHOOK_REQUIRE_HTTPS,
      allowlist: config.WEBHOOK_ALLOWLIST
    }), config.WEBHOOK_TIMEOUT_MS, "DNS lookup timed out");
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
      if (!await WebhookRepo.markSent(j.id, j.claim_token)) {
        logger.warn({ id: j.id }, "Webhook delivery claim was reclaimed before completion");
        return;
      }
      await emitBillingEvent({ businessId: j.business_id, eventType: "webhook.sent", amount: 1, unit: "count", metadata: { event: j.event } });
    });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Timeout" : (e?.message ?? String(e));
    logger.warn({ id: j.id, err: msg }, "Webhook delivery failed");
    await withDbClientContext({ tenantId: j.business_id, platformAdmin: false }, async () => {
      if (!await WebhookRepo.recordFailure(j.id, msg, config.WEBHOOK_MAX_ATTEMPTS, j.claim_token)) return;
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
  const batchSize = 25;
  const concurrency = Math.max(1, Number(config.WEBHOOK_CONCURRENCY || 5));
  const leaseSeconds = deliveryLeaseSeconds({ batchSize, concurrency, timeoutMs: config.WEBHOOK_TIMEOUT_MS });
  // Claim quickly under platform admin context, then release DB connection before doing network I/O.
  const jobs = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    return WebhookRepo.claimPending(batchSize, config.WEBHOOK_MAX_ATTEMPTS, leaseSeconds);
  });
  if (!jobs.length) return;

  await mapLimit([...jobs], concurrency, deliverOne);
}
