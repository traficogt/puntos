import nodemailer from "nodemailer";

function resolveSecure(config) {
  if (config.SMTP_SECURE === "true") return true;
  if (config.SMTP_SECURE === "false") return false;
  return Number(config.SMTP_PORT) === 465;
}

export function createSmtpProvider({ config, transportFactory = nodemailer.createTransport }) {
  return {
    name: "smtp_email",
    canSend({ destinations }) {
      return Boolean(destinations?.email && config.SMTP_HOST);
    },
    async send({ destinations, body }) {
      const transport = transportFactory({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: resolveSecure(config),
        ...(config.SMTP_USER || config.SMTP_PASS
          ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
          : {})
      });
      const info = await transport.sendMail({
        from: config.SMTP_FROM,
        to: destinations.email,
        subject: "PuntosFieles",
        text: body
      });
      return { ok: true, providerId: info?.messageId ?? "smtp" };
    }
  };
}
