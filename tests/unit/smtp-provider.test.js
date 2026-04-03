import test from "node:test";
import assert from "node:assert/strict";

import { createSmtpProvider } from "../../src/app/services/messaging/providers/smtp-provider.js";

test("smtp provider omits auth when user and pass are empty", async () => {
  /** @type {{ host: string, port: number, secure: boolean, ignoreTLS?: boolean, requireTLS?: boolean, auth?: { user: string, pass: string } } | null} */
  let capturedConfig = null;
  const provider = createSmtpProvider({
    config: {
      SMTP_HOST: "10.10.1.20",
      SMTP_PORT: 26,
      SMTP_SECURE: "false",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "hola@puntosfieles.com"
    },
    transportFactory(options) {
      capturedConfig = options;
      return {
        async sendMail() {
          return { messageId: "smtp-id" };
        }
      };
    }
  });

  const out = await provider.send({
    destinations: { email: "cliente@test.com" },
    body: "Tu código"
  });

  assert.ok(capturedConfig);
  assert.equal(out.providerId, "smtp-id");
  assert.equal(capturedConfig.host, "10.10.1.20");
  assert.equal(capturedConfig.port, 26);
  assert.equal(capturedConfig.secure, false);
  assert.equal(capturedConfig.ignoreTLS, true);
  assert.equal(capturedConfig.requireTLS, false);
  assert.equal("auth" in capturedConfig, false);
});

test("smtp provider sends subject text and html when provided", async () => {
  /** @type {{ subject: string, text: string, html?: string, from: string, to: string } | null} */
  let capturedMail = null;
  const provider = createSmtpProvider({
    config: {
      SMTP_HOST: "10.10.1.20",
      SMTP_PORT: 26,
      SMTP_SECURE: "false",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "hola@puntosfieles.com"
    },
    transportFactory() {
      return {
        async sendMail(payload) {
          capturedMail = payload;
          return { messageId: "smtp-html-id" };
        }
      };
    }
  });

  const out = await provider.send({
    destinations: { email: "cliente@test.com" },
    body: "Linea uno",
    subject: "Prueba HTML",
    text: "Linea uno",
    html: "<p><strong>Linea uno</strong></p>"
  });

  assert.ok(capturedMail);
  assert.equal(out.providerId, "smtp-html-id");
  assert.equal(capturedMail.from, "hola@puntosfieles.com");
  assert.equal(capturedMail.to, "cliente@test.com");
  assert.equal(capturedMail.subject, "Prueba HTML");
  assert.equal(capturedMail.text, "Linea uno");
  assert.equal(capturedMail.html, "<p><strong>Linea uno</strong></p>");
});
