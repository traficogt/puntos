import test from "node:test";
import assert from "node:assert/strict";

import { renderEmailMessage } from "../../src/app/services/messaging/email-renderer.js";

const tenantBranding = {
  scope: "tenant",
  brandName: "Recompensas Cafe Bourbon",
  logoUrl: "https://cdn.example.com/logo.png",
  primaryColor: "#6D3524",
  accentColor: "#D7A554",
  poweredByVisible: true
};

test("renderEmailMessage wraps legacy body content in a branded email shape", async () => {
  const out = await renderEmailMessage({
    channel: "verify",
    body: "Tu código es 123456",
    branding: tenantBranding
  });

  assert.equal(typeof out.subject, "string");
  assert.equal(out.text.includes("123456"), true);
  assert.equal(out.html.includes("Recompensas Cafe Bourbon"), true);
  assert.equal(out.html.includes("Tu código es 123456"), true);
});

test("renderEmailMessage renders verification email with code emphasis", async () => {
  const out = await renderEmailMessage({
    channel: "verify",
    branding: tenantBranding,
    email: {
      type: "verify",
      businessName: "Cafe Bourbon",
      code: "654321",
      expiresText: "Vence en 10 minutos."
    }
  });

  assert.equal(out.subject.length > 0, true);
  assert.equal(out.text.includes("654321"), true);
  assert.equal(out.html.includes("654321"), true);
  assert.equal(out.html.includes("Vence en 10 minutos."), true);
});

test("renderEmailMessage renders platform branding when no business branding is present", async () => {
  const out = await renderEmailMessage({
    channel: "security",
    branding: {
      scope: "platform",
      brandName: "PuntosFieles",
      logoUrl: "https://puntosfieles.com/icon-192.png?v=2",
      wordmarkUrl: "https://puntosfieles.com/pf-email-wordmark.png?v=2",
      lockupUrl: "https://puntosfieles.com/pf-email-lockup.png?v=2",
      primaryColor: "#6D3524",
      accentColor: "#D7A554",
      poweredByVisible: false
    },
    email: {
      type: "security",
      subject: "Prueba de seguridad",
      title: "Actividad detectada",
      lines: ["Revisamos un acceso reciente."]
    }
  });

  assert.equal(out.subject, "Prueba de seguridad");
  assert.equal(out.html.includes("PuntosFieles"), true);
  assert.equal(out.html.includes("Actividad detectada"), true);
  assert.equal(out.html.includes("pf-email-lockup.png?v=2"), true);
});

test("renderEmailMessage renders lifecycle email content", async () => {
  const out = await renderEmailMessage({
    channel: "lifecycle",
    branding: tenantBranding,
    email: {
      type: "lifecycle",
      subject: "Feliz cumpleaños",
      title: "Feliz cumpleaños",
      intro: "Hoy celebramos contigo.",
      lines: ["Te regalamos 25 puntos."],
      tone: "celebration"
    }
  });

  assert.equal(out.subject, "Feliz cumpleaños");
  assert.equal(out.html.includes("Te regalamos 25 puntos."), true);
});

test("renderEmailMessage renders churn email content", async () => {
  const out = await renderEmailMessage({
    channel: "CHURN",
    branding: tenantBranding,
    email: {
      type: "churn",
      subject: "Te extrañamos",
      title: "Te extrañamos",
      intro: "Vuelve a visitarnos esta semana.",
      lines: ["Tu programa de lealtad sigue activo."]
    }
  });

  assert.equal(out.subject, "Te extrañamos");
  assert.equal(out.html.includes("Vuelve a visitarnos esta semana."), true);
});
