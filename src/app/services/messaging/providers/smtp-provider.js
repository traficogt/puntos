import nodemailer from "nodemailer";

function resolveSecure(config) {
  if (config.SMTP_SECURE === "true") return true;
  if (config.SMTP_SECURE === "false") return false;
  return Number(config.SMTP_PORT) === 465;
}

function resolveTransportSecurity(config) {
  if (config.SMTP_SECURE === "false") {
    return {
      // Explicit plaintext SMTP for local relays that advertise STARTTLS with
      // certificates that do not match their private IPs.
      ignoreTLS: true,
      requireTLS: false
    };
  }
  return {};
}

export function createSmtpProvider({ config, transportFactory = nodemailer.createTransport }) {
  return {
    name: "smtp_email",
    canSend({ destinations }) {
      return Boolean(destinations?.email && config.SMTP_HOST);
    },
    async send({ destinations, body, subject = "PuntosFieles", text = body, html = "" }) {
      const transport = transportFactory({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: resolveSecure(config),
        ...resolveTransportSecurity(config),
        ...(config.SMTP_USER || config.SMTP_PASS
          ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
          : {})
      });
      const info = await transport.sendMail({
        from: config.SMTP_FROM,
        to: destinations.email,
        subject,
        text: String(text || body || ""),
        ...(html ? { html } : {})
      });
      return { ok: true, providerId: info?.messageId ?? "smtp" };
    }
  };
}
