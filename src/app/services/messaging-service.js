import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { MessageLogRepo } from "../repositories/message-log-repository.js";
import crypto from "node:crypto";
import { emitBillingEvent } from "./billing-service.js";
import { createMessageRouter } from "./messaging/message-router.js";
import { createDevProvider } from "./messaging/providers/dev-provider.js";
import { createSmtpProvider } from "./messaging/providers/smtp-provider.js";
import { createWhatsAppCloudProvider } from "./messaging/providers/whatsapp-cloud-provider.js";
import { createWahaProvider } from "./messaging/providers/waha-provider.js";
import { createTwilioProvider } from "./messaging/providers/twilio-provider.js";
import { createBaileysProvider } from "./messaging/providers/baileys-provider.js";

function id() { return crypto.randomUUID(); }

function inferDestinations(to, destinations) {
  const target = String(to || "").trim();
  const inferredEmail = target.includes("@") ? target : "";
  const inferredPhone = !inferredEmail ? target : "";
  return {
    phone: destinations?.phone || inferredPhone || null,
    email: destinations?.email || inferredEmail || null
  };
}

function buildProviderOrder() {
  const order = Array.isArray(config.MESSAGE_PROVIDER_ORDER)
    ? config.MESSAGE_PROVIDER_ORDER.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return order.length > 0 ? order : [String(config.MESSAGE_PROVIDER || "dev").trim()];
}

function buildRouter() {
  return createMessageRouter({
    order: buildProviderOrder(),
    providers: {
      dev: createDevProvider(),
      smtp_email: createSmtpProvider({ config }),
      whatsapp_cloud: createWhatsAppCloudProvider({ config }),
      waha: createWahaProvider({ config }),
      twilio: createTwilioProvider({ config }),
      baileys: createBaileysProvider({ config })
    }
  });
}

export async function sendMessage({ businessId, customerId = null, channel, to, body, privilegedLog = false, destinations = null }) {
  const logId = id();
  const safeBody = channel === "verify" ? String(body).replace(/\b\d{6}\b/g, "******") : body;
  const createLog = privilegedLog ? MessageLogRepo.createSecurity.bind(MessageLogRepo) : MessageLogRepo.create.bind(MessageLogRepo);
  const updateLog = privilegedLog ? MessageLogRepo.updateSecurityStatus.bind(MessageLogRepo) : MessageLogRepo.updateStatus.bind(MessageLogRepo);
  const resolvedDestinations = inferDestinations(to, destinations);
  const logTarget = String(to || resolvedDestinations.email || resolvedDestinations.phone || "").trim();
  await createLog({
    id: logId,
    business_id: businessId,
    customer_id: customerId,
    channel,
    to_addr: logTarget,
    body: safeBody,
    status: "QUEUED",
    provider_id: null,
    error: null
  });

  let sendOk = false;
  try {
    const router = buildRouter();
    const routed = await router.send({
      channel,
      body,
      destinations: resolvedDestinations
    });
    if (!routed?.ok) {
      const attempts = Array.isArray(routed?.attempts) ? routed.attempts.join(",") : "";
      throw new Error(attempts ? `NO_DELIVERY_PROVIDER:${attempts}` : "NO_DELIVERY_PROVIDER");
    }
    await updateLog(logId, { status: "SENT", provider_id: routed.providerId ?? routed.provider ?? "message", error: null });
    sendOk = true;
    return { ok: true, id: logId, provider: routed.provider };
  } catch (e) {
    const msg = e?.message ?? String(e);
    logger.error({ err: msg }, "sendMessage failed");
    await updateLog(logId, { status: "FAILED", error: msg, provider_id: null });
    return { ok: false, id: logId, error: msg };
  }
  finally {
    // Record usage even on failure for billing transparency
    const base = { businessId, amount: 1, unit: "count", metadata: { channel } };
    await emitBillingEvent({ ...base, eventType: "message.attempt" });
    await emitBillingEvent({ ...base, eventType: sendOk ? "message.sent" : "message.failed" });
  }
}

export function verificationBody({ businessName, code }) {
  return `PuntosFieles • ${businessName}\n\nTu código es: ${code}\nVence en 10 minutos.`;
}

export function churnBody({ businessName }) {
  return `¡Te extrañamos en ${businessName}! Visítanos esta semana y gana puntos dobles.`;
}
