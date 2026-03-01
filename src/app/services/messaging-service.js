import nodemailer from "nodemailer";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { MessageLogRepo } from "../repositories/message-log-repository.js";
import crypto from "node:crypto";
import { emitBillingEvent } from "./billing-service.js";

function id() { return crypto.randomUUID(); }

export async function sendMessage({ businessId, customerId = null, channel, to, body }) {
  const logId = id();
  const safeBody = channel === "verify" ? String(body).replace(/\b\d{6}\b/g, "******") : body;
  await MessageLogRepo.create({
    id: logId,
    business_id: businessId,
    customer_id: customerId,
    channel,
    to_addr: to,
    body: safeBody,
    status: "QUEUED",
    provider_id: null,
    error: null
  });

  let sendOk = false;
  try {
    const provider = config.MESSAGE_PROVIDER;

    if (provider === "dev") {
      logger.info({ channel, to, body: safeBody }, "[MESSAGE dev]");
      await MessageLogRepo.updateStatus(logId, { status: "SENT", provider_id: "dev", error: null });
      sendOk = true;
      return { ok: true, id: logId };
    }

    if (provider === "whatsapp_cloud") {
      if (!config.WA_PHONE_NUMBER_ID || !config.WA_ACCESS_TOKEN) throw new Error("WhatsApp Cloud env not configured");
      // Send as text message. You can switch to templates later.
      const url = `https://graph.facebook.com/v19.0/${config.WA_PHONE_NUMBER_ID}/messages`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body }
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(data));
      await MessageLogRepo.updateStatus(logId, { status: "SENT", provider_id: data?.messages?.[0]?.id ?? "wa", error: null });
      sendOk = true;
      return { ok: true, id: logId };
    }

    if (provider === "smtp_email") {
      if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) throw new Error("SMTP env not configured");
      const transport = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
      });
      const info = await transport.sendMail({
        from: config.SMTP_FROM,
        to,
        subject: "PuntosFieles",
        text: body
      });
      await MessageLogRepo.updateStatus(logId, { status: "SENT", provider_id: info.messageId, error: null });
      sendOk = true;
      return { ok: true, id: logId };
    }

    if (provider === "http_sms_gateway") {
      if (!config.SMS_GATEWAY_URL) throw new Error("SMS_GATEWAY_URL missing");
      const resp = await fetch(config.SMS_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.SMS_GATEWAY_TOKEN ? { "Authorization": `Bearer ${config.SMS_GATEWAY_TOKEN}` } : {})
        },
        body: JSON.stringify({ to, body })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(JSON.stringify(data));
      await MessageLogRepo.updateStatus(logId, { status: "SENT", provider_id: data.id ?? "sms", error: null });
      sendOk = true;
      return { ok: true, id: logId };
    }

    throw new Error(`Unknown MESSAGE_PROVIDER: ${provider}`);
  } catch (e) {
    const msg = e?.message ?? String(e);
    logger.error({ err: msg }, "sendMessage failed");
    await MessageLogRepo.updateStatus(logId, { status: "FAILED", error: msg, provider_id: null });
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
