import nodemailer from "nodemailer";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml({ name, contact, message }) {
  const timestamp = new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala" });
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#fdf9f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1008;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9f4;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="background:#1a1008;border-radius:16px 16px 0 0;padding:28px 32px 24px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(240,235,228,0.36);">PuntosFieles</p>
          <p style="margin:8px 0 0;font-size:20px;font-weight:300;letter-spacing:-0.01em;color:#fff;">Nuevo mensaje de contacto</p>
        </td></tr>
        <tr><td style="background:#ffffff;padding:28px 32px;border-left:1px solid #e8dfd0;border-right:1px solid #e8dfd0;">
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#a08060;">Nombre</p>
          <p style="margin:0 0 20px;font-size:16px;color:#1a1008;">${escapeHtml(name)}</p>
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#a08060;">Correo / Teléfono</p>
          <p style="margin:0 0 20px;font-size:16px;color:#1a1008;">${escapeHtml(contact)}</p>
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#a08060;">Mensaje</p>
          <p style="margin:0;font-size:15px;line-height:1.65;color:#1a1008;white-space:pre-wrap;">${escapeHtml(message)}</p>
        </td></tr>
        <tr><td style="background:#f3ece0;border-radius:0 0 16px 16px;padding:14px 32px;border:1px solid #e8dfd0;border-top:none;">
          <p style="margin:0;font-size:12px;color:#a08060;">${escapeHtml(timestamp)} · puntosfieles.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function verifyTurnstile(token, remoteip) {
  if (!config.CONTACT_TURNSTILE_SECRET) return true; // disabled in dev
  const body = new URLSearchParams({
    secret: config.CONTACT_TURNSTILE_SECRET,
    response: token,
    ...(remoteip ? { remoteip } : {})
  });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  const data = await res.json();
  return data.success === true;
}

export async function sendContactEmail({ name, contact, message }) {
  if (!config.CONTACT_TO) {
    logger.info({ name, contact }, "[CONTACT] CONTACT_TO not configured — logging only");
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.CONTACT_SMTP_HOST,
    port: config.CONTACT_SMTP_PORT,
    secure: false,
    ignoreTLS: true
  });

  await transport.sendMail({
    from: config.CONTACT_FROM,
    to: config.CONTACT_TO,
    subject: `Mensaje de contacto — ${name}`,
    text: `Nombre: ${name}\nContacto: ${contact}\n\nMensaje:\n${message}`,
    html: buildEmailHtml({ name, contact, message })
  });

  logger.info({ name }, "[CONTACT] Email sent");
}
