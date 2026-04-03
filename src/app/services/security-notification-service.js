import { sendMessage } from "./messaging-service.js";
import { logger } from "../../utils/logger.js";

export async function sendSecurityNotification({
  businessId = null,
  to,
  subject,
  lines = []
}) {
  const target = String(to || "").trim();
  if (!target) return { ok: false, skipped: true };
  const body = [String(subject || "PuntosFieles seguridad"), "", ...lines.map((line) => String(line || "").trim()).filter(Boolean)].join("\n");
  const result = await sendMessage({
    businessId,
    customerId: null,
    channel: "security",
    to: target,
    body,
    subject: String(subject || "PuntosFieles seguridad"),
    email: {
      type: "security",
      subject: String(subject || "PuntosFieles seguridad"),
      title: String(subject || "PuntosFieles seguridad"),
      lines
    },
    privilegedLog: true
  });
  if (!result?.ok) {
    logger.warn({ to: target }, "Security notification delivery failed");
  }
  return result;
}
