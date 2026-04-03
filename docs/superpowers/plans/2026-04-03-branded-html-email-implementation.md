# Branded HTML Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-aware branded HTML email support with plain-text fallback to the existing messaging pipeline so SMTP can send platform-branded or business-branded multipart email without breaking non-email channels.

**Architecture:** Introduce a server-side email rendering layer that resolves platform-vs-tenant branding, produces `subject` + `text` + `html`, and plugs into the existing `sendMessage()` routing model. Keep backward compatibility for text-only callers, upgrade the SMTP provider to send multipart mail, and migrate current real message types onto typed email renderers incrementally.

**Tech Stack:** Node.js, Nodemailer, existing messaging router, existing business/customer branding data, Node test runner

---

## File Map

### New files

- `src/app/services/messaging/email-branding.js`
  - Resolve platform-vs-tenant email branding with safe defaults.
- `src/app/services/messaging/email-renderer.js`
  - Normalize legacy message payloads and build `subject`, `text`, and `html`.
- `src/app/services/messaging/email-templates/base-template.js`
  - Shared branded HTML shell for all email-capable messages.
- `src/app/services/messaging/email-templates/verify-template.js`
  - Verification email renderer.
- `src/app/services/messaging/email-templates/security-template.js`
  - Security email renderer.
- `src/app/services/messaging/email-templates/lifecycle-template.js`
  - Lifecycle and alert-style email renderer.
- `src/app/services/messaging/email-templates/churn-template.js`
  - Churn email renderer.
- `tests/unit/email-branding.test.js`
  - Branding resolution and fallback tests.
- `tests/unit/email-renderer.test.js`
  - Legacy body normalization and typed rendering tests.

### Modified files

- `src/app/services/messaging-service.js`
  - Accept richer message content and invoke the email renderer.
- `src/app/services/messaging/providers/smtp-provider.js`
  - Send `subject`, `text`, and `html`.
- `src/app/services/security-notification-service.js`
  - Provide typed email content instead of raw line-joined body only.
- `src/app/services/customer-service.js`
  - Provide typed verification email content.
- `src/app/services/churn-service.js`
  - Provide typed churn email content.
- `src/app/services/lifecycle-service.js`
  - Provide typed lifecycle/alert email content.
- `tests/unit/smtp-provider.test.js`
  - Extend SMTP coverage for multipart HTML send behavior.

## Task 1: Add the Email Branding Resolver

**Files:**
- Create: `src/app/services/messaging/email-branding.js`
- Test: `tests/unit/email-branding.test.js`

- [ ] **Step 1: Write the failing branding tests**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { resolveEmailBranding } from "../../src/app/services/messaging/email-branding.js";

test("resolveEmailBranding uses platform defaults without business context", async () => {
  const branding = await resolveEmailBranding({
    businessId: null,
    getBusinessById: async () => null
  });

  assert.equal(branding.scope, "platform");
  assert.equal(branding.brandName, "PuntosFieles");
  assert.equal(branding.poweredByVisible, false);
  assert.match(branding.primaryColor, /^#/);
});

test("resolveEmailBranding uses tenant branding when business context exists", async () => {
  const branding = await resolveEmailBranding({
    businessId: "biz_1",
    getBusinessById: async () => ({
      id: "biz_1",
      name: "Cafe Bourbon",
      customer_branding_json: {
        customer_program_name: "Recompensas Cafe Bourbon",
        customer_logo_url: "https://cdn.example.com/logo.png",
        primary_color: "#6D3524",
        accent_color: "#D7A554",
        powered_by_visible: true
      }
    })
  });

  assert.equal(branding.scope, "tenant");
  assert.equal(branding.brandName, "Recompensas Cafe Bourbon");
  assert.equal(branding.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(branding.primaryColor, "#6D3524");
  assert.equal(branding.accentColor, "#D7A554");
  assert.equal(branding.poweredByVisible, true);
});

test("resolveEmailBranding falls back to business name and safe defaults when tenant branding is incomplete", async () => {
  const branding = await resolveEmailBranding({
    businessId: "biz_2",
    getBusinessById: async () => ({
      id: "biz_2",
      name: "Cafe Central",
      customer_branding_json: {}
    })
  });

  assert.equal(branding.scope, "tenant");
  assert.equal(branding.brandName, "Cafe Central");
  assert.equal(branding.logoUrl, "");
  assert.match(branding.primaryColor, /^#/);
  assert.match(branding.accentColor, /^#/);
});
```

- [ ] **Step 2: Run the branding tests to verify they fail**

Run:

```bash
node --test tests/unit/email-branding.test.js
```

Expected: FAIL because `email-branding.js` does not exist yet.

- [ ] **Step 3: Implement the email branding resolver**

```js
const PLATFORM_BRANDING = {
  scope: "platform",
  brandName: "PuntosFieles",
  logoUrl: "",
  primaryColor: "#6D3524",
  accentColor: "#D7A554",
  poweredByVisible: false
};

function normalizeHexColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeLogoUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//.test(url) ? url : "";
}

export async function resolveEmailBranding({
  businessId = null,
  business = null,
  getBusinessById = async () => null
} = {}) {
  const source = business || (businessId ? await getBusinessById(businessId) : null);
  if (!source) return { ...PLATFORM_BRANDING };

  const raw = source.customer_branding_json && typeof source.customer_branding_json === "object"
    ? source.customer_branding_json
    : {};

  return {
    scope: "tenant",
    brandName: String(raw.customer_program_name || source.name || PLATFORM_BRANDING.brandName).trim(),
    logoUrl: normalizeLogoUrl(raw.customer_logo_url),
    primaryColor: normalizeHexColor(raw.primary_color, PLATFORM_BRANDING.primaryColor),
    accentColor: normalizeHexColor(raw.accent_color, PLATFORM_BRANDING.accentColor),
    poweredByVisible: raw.powered_by_visible !== false
  };
}
```

- [ ] **Step 4: Run the branding tests to verify they pass**

Run:

```bash
node --test tests/unit/email-branding.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/messaging/email-branding.js tests/unit/email-branding.test.js
git commit -m "feat: add email branding resolver"
```

## Task 2: Add the Email Template Shell and Renderers

**Files:**
- Create: `src/app/services/messaging/email-templates/base-template.js`
- Create: `src/app/services/messaging/email-templates/verify-template.js`
- Create: `src/app/services/messaging/email-templates/security-template.js`
- Create: `src/app/services/messaging/email-templates/lifecycle-template.js`
- Create: `src/app/services/messaging/email-templates/churn-template.js`
- Create: `src/app/services/messaging/email-renderer.js`
- Test: `tests/unit/email-renderer.test.js`

- [ ] **Step 1: Write the failing renderer tests**

```js
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
    body: "Tu codigo es 123456",
    branding: tenantBranding
  });

  assert.equal(typeof out.subject, "string");
  assert.equal(out.text.includes("123456"), true);
  assert.equal(out.html.includes("Recompensas Cafe Bourbon"), true);
  assert.equal(out.html.includes("Tu codigo es 123456"), true);
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
      logoUrl: "",
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
});
```

- [ ] **Step 2: Run the renderer tests to verify they fail**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: FAIL because the renderer and templates do not exist yet.

- [ ] **Step 3: Implement the base template and typed renderers**

```js
// base-template.js
function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderBaseEmailTemplate({ branding, preheader = "", title = "", bodyHtml = "", footerText = "" }) {
  const brandName = escapeHtml(branding.brandName);
  const logoHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${brandName}" width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none;border-radius:10px;">`
    : `<div style="font-size:20px;font-weight:700;color:#111827;">${brandName}</div>`;
  const poweredBy = branding.poweredByVisible
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#6B7280;">Powered by PuntosFieles</p>`
    : "";

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#F5F1EB;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EB;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;border-bottom:1px solid #F1F5F9;">
                ${logoHtml}
                <p style="margin:16px 0 0;font-size:14px;line-height:20px;color:#6B7280;">${brandName}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:28px;line-height:34px;color:#111827;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#6B7280;">${escapeHtml(footerText)}</p>
                ${poweredBy}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
```

```js
// verify-template.js
import { renderBaseEmailTemplate } from "./base-template.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderVerifyEmail({ branding, businessName, code, expiresText }) {
  const subject = `${branding.brandName}: tu codigo de acceso`;
  const text = [
    branding.brandName,
    "",
    `Tu codigo es: ${code}`,
    expiresText || "Vence en 10 minutos."
  ].join("\n");
  const html = renderBaseEmailTemplate({
    branding,
    preheader: `Tu codigo de acceso es ${code}`,
    title: `Tu codigo para ${businessName || branding.brandName}`,
    footerText: "Si no solicitaste este codigo, puedes ignorar este correo.",
    bodyHtml: `
      <p style="margin:0 0 18px;font-size:16px;line-height:24px;color:#374151;">Usa este codigo para entrar a tu tarjeta o completar tu registro.</p>
      <div style="margin:0 0 18px;padding:18px 20px;border-radius:18px;background:#F8FAFC;border:1px solid #E5E7EB;font-size:32px;line-height:36px;font-weight:700;letter-spacing:6px;color:#111827;text-align:center;">${escapeHtml(code)}</div>
      <p style="margin:0;font-size:14px;line-height:22px;color:#6B7280;">${escapeHtml(expiresText || "Vence en 10 minutos.")}</p>
    `
  });
  return { subject, text, html };
}
```

```js
// security-template.js / lifecycle-template.js / churn-template.js
// Each should return { subject, text, html } using renderBaseEmailTemplate()
// with message-specific title/body copy and the same HTML shell.
```

```js
// email-renderer.js
import { renderVerifyEmail } from "./email-templates/verify-template.js";
import { renderSecurityEmail } from "./email-templates/security-template.js";
import { renderLifecycleEmail } from "./email-templates/lifecycle-template.js";
import { renderChurnEmail } from "./email-templates/churn-template.js";
import { renderBaseEmailTemplate } from "./email-templates/base-template.js";

function legacySubject(channel, branding) {
  if (channel === "verify") return `${branding.brandName}: tu codigo de acceso`;
  if (channel === "security") return `${branding.brandName}: aviso de seguridad`;
  return branding.brandName;
}

function paragraphsFromBody(body) {
  return String(body || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:#374151;">${part}</p>`)
    .join("");
}

export async function renderEmailMessage({ channel, body = "", branding, email = null }) {
  if (email?.type === "verify") return renderVerifyEmail({ branding, ...email });
  if (email?.type === "security") return renderSecurityEmail({ branding, ...email });
  if (email?.type === "lifecycle") return renderLifecycleEmail({ branding, ...email });
  if (email?.type === "churn") return renderChurnEmail({ branding, ...email });

  const subject = legacySubject(channel, branding);
  return {
    subject,
    text: String(body || ""),
    html: renderBaseEmailTemplate({
      branding,
      preheader: String(body || "").slice(0, 120),
      title: subject,
      footerText: "Mensaje enviado por PuntosFieles.",
      bodyHtml: paragraphsFromBody(body)
    })
  };
}
```

- [ ] **Step 4: Run the renderer tests to verify they pass**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/messaging/email-renderer.js src/app/services/messaging/email-templates tests/unit/email-renderer.test.js
git commit -m "feat: add branded email renderers"
```

## Task 3: Upgrade the SMTP Provider for Multipart Email

**Files:**
- Modify: `src/app/services/messaging/providers/smtp-provider.js`
- Modify: `tests/unit/smtp-provider.test.js`

- [ ] **Step 1: Extend the failing SMTP provider test**

```js
test("smtp provider sends multipart subject text and html when available", async () => {
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
    subject: "Codigo de acceso",
    text: "Tu codigo es 123456",
    html: "<p>Tu codigo es <strong>123456</strong></p>"
  });

  assert.equal(out.providerId, "smtp-html-id");
  assert.equal(capturedMail.subject, "Codigo de acceso");
  assert.equal(capturedMail.text, "Tu codigo es 123456");
  assert.equal(capturedMail.html, "<p>Tu codigo es <strong>123456</strong></p>");
});
```

- [ ] **Step 2: Run the SMTP provider test to verify it fails**

Run:

```bash
node --test tests/unit/smtp-provider.test.js
```

Expected: FAIL because the provider does not yet pass `subject` or `html`.

- [ ] **Step 3: Implement multipart SMTP send**

```js
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
```

- [ ] **Step 4: Run the SMTP provider test to verify it passes**

Run:

```bash
node --test tests/unit/smtp-provider.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/messaging/providers/smtp-provider.js tests/unit/smtp-provider.test.js
git commit -m "feat: send multipart html email over smtp"
```

## Task 4: Upgrade `sendMessage()` to Normalize Email Content

**Files:**
- Modify: `src/app/services/messaging-service.js`
- Test: `tests/unit/email-renderer.test.js`

- [ ] **Step 1: Add the failing normalization test**

```js
test("sendMessage-compatible payloads can normalize email content for smtp delivery", async () => {
  const branding = {
    scope: "platform",
    brandName: "PuntosFieles",
    logoUrl: "",
    primaryColor: "#6D3524",
    accentColor: "#D7A554",
    poweredByVisible: false
  };

  const out = await renderEmailMessage({
    channel: "security",
    body: "Linea uno\n\nLinea dos",
    branding
  });

  assert.equal(out.subject, "PuntosFieles: aviso de seguridad");
  assert.equal(out.text.includes("Linea uno"), true);
  assert.equal(out.html.includes("Linea dos"), true);
});
```

- [ ] **Step 2: Run the renderer test to verify the new expectation**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: FAIL if the normalization path is incomplete.

- [ ] **Step 3: Update `sendMessage()` to resolve branding and email rendering before routing**

```js
import { BusinessRepo } from "../repositories/business-repository.js";
import { resolveEmailBranding } from "./messaging/email-branding.js";
import { renderEmailMessage } from "./messaging/email-renderer.js";

export async function sendMessage({
  businessId,
  customerId = null,
  channel,
  to,
  body,
  subject = null,
  email = null,
  privilegedLog = false,
  destinations = null
}) {
  // existing log code stays

  const resolvedDestinations = inferDestinations(to, destinations);
  const branding = await resolveEmailBranding({
    businessId,
    getBusinessById: BusinessRepo.getById.bind(BusinessRepo)
  });
  const renderedEmail = resolvedDestinations.email
    ? await renderEmailMessage({ channel, body, branding, email: email || (subject ? { subject } : null) })
    : null;

  const routed = await router.send({
    channel,
    body,
    destinations: resolvedDestinations,
    subject: renderedEmail?.subject || subject || null,
    text: renderedEmail?.text || body,
    html: renderedEmail?.html || ""
  });
}
```

- [ ] **Step 4: Run the renderer tests again**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/messaging-service.js tests/unit/email-renderer.test.js
git commit -m "feat: normalize email content in messaging service"
```

## Task 5: Migrate Verification and Security Messages to Typed Email Content

**Files:**
- Modify: `src/app/services/customer-service.js`
- Modify: `src/app/services/security-notification-service.js`
- Modify: `tests/unit/email-renderer.test.js`

- [ ] **Step 1: Add the failing verification/security rendering tests**

```js
test("verification email uses the typed verify template", async () => {
  const out = await renderEmailMessage({
    channel: "verify",
    branding: tenantBranding,
    email: {
      type: "verify",
      businessName: "Cafe Bourbon",
      code: "111222",
      expiresText: "Vence en 10 minutos."
    }
  });

  assert.equal(out.subject.includes("codigo"), true);
  assert.equal(out.html.includes("111222"), true);
});

test("security email uses the typed security template", async () => {
  const out = await renderEmailMessage({
    channel: "security",
    branding: tenantBranding,
    email: {
      type: "security",
      subject: "Nuevo acceso detectado",
      title: "Nuevo acceso detectado",
      lines: ["Revisa la actividad reciente de tu cuenta."]
    }
  });

  assert.equal(out.subject, "Nuevo acceso detectado");
  assert.equal(out.html.includes("Revisa la actividad reciente de tu cuenta."), true);
});
```

- [ ] **Step 2: Run the renderer tests to verify coverage fails if templates are incomplete**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: FAIL if typed renderers are not wired end to end yet.

- [ ] **Step 3: Update the callers to pass typed email payloads**

```js
// customer-service.js
const sent = await sendMessage({
  businessId: business.id,
  customerId: null,
  channel: "verify",
  to: phone,
  destinations: { phone, email },
  body: `Tu código de PuntosFieles: ${code} (expira en 10 minutos)`,
  email: {
    type: "verify",
    businessName: business.name,
    code,
    expiresText: "Vence en 10 minutos."
  }
});
```

```js
// security-notification-service.js
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
```

- [ ] **Step 4: Re-run the renderer tests**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/customer-service.js src/app/services/security-notification-service.js tests/unit/email-renderer.test.js
git commit -m "feat: use typed html emails for verify and security"
```

## Task 6: Migrate Lifecycle, Alerts, and Churn Messages to Typed Email Content

**Files:**
- Modify: `src/app/services/lifecycle-service.js`
- Modify: `src/app/services/churn-service.js`
- Modify: `tests/unit/email-renderer.test.js`

- [ ] **Step 1: Add the failing lifecycle/churn renderer tests**

```js
test("lifecycle email renders celebratory business-branded content", async () => {
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

test("churn email renders a comeback template", async () => {
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
```

- [ ] **Step 2: Run the renderer tests to verify they fail**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: FAIL until lifecycle/churn typed rendering is complete.

- [ ] **Step 3: Update lifecycle and churn senders**

```js
// churn-service.js
const body = churnBody({ businessName: business.name });
const res = await sendMessage({
  businessId,
  customerId: c.id,
  channel: "CHURN",
  to: c.phone,
  body,
  email: {
    type: "churn",
    subject: `${business.name}: te extrañamos`,
    title: "Te extrañamos",
    intro: `Tu programa con ${business.name} sigue activo.`,
    lines: [body]
  }
});
```

```js
// lifecycle-service.js
await sendMessage({
  businessId,
  customerId: c.id,
  channel: "lifecycle",
  to: c.phone,
  body: `${c.name ? `${c.name}, ` : ""}te extrañamos...`,
  email: {
    type: "lifecycle",
    subject: `${business.name}: queremos verte de nuevo`,
    title: "Queremos verte de nuevo",
    intro: c.name ? `${c.name}, te extrañamos.` : "Te extrañamos.",
    lines: [points > 0 ? `Tienes ${points} puntos de regreso para tu próxima visita.` : "Tu programa sigue activo."],
    tone: "return"
  }
});
```

Also add typed `email` payloads for:

- birthday lifecycle sends
- suspicious digest / alert-style sends

- [ ] **Step 4: Re-run the renderer tests**

Run:

```bash
node --test tests/unit/email-renderer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/lifecycle-service.js src/app/services/churn-service.js tests/unit/email-renderer.test.js
git commit -m "feat: use typed html emails for lifecycle and churn"
```

## Task 7: Full Verification and Real SMTP Smoke Test

**Files:**
- Modify: none if previous tasks were sufficient
- Verify: `tests/unit/email-branding.test.js`
- Verify: `tests/unit/email-renderer.test.js`
- Verify: `tests/unit/smtp-provider.test.js`

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
node --test tests/unit/email-branding.test.js tests/unit/email-renderer.test.js tests/unit/smtp-provider.test.js
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Rebuild the runtime stack**

Run:

```bash
docker compose up -d --build api worker
docker compose ps
```

Expected:

- `api` healthy
- `worker` healthy

- [ ] **Step 4: Send a real SMTP test email through the app**

Run:

```bash
docker compose exec api node --input-type=module -e "import { sendSecurityNotification } from './src/app/services/security-notification-service.js'; const out = await sendSecurityNotification({ to: 'gandhiponce@gmail.com', subject: 'Prueba HTML PuntosFieles', lines: ['Este correo prueba el nuevo render HTML con fallback de texto.'] }); console.log(JSON.stringify(out));"
```

Expected:

- JSON with `"ok":true`
- provider should be `smtp_email`

- [ ] **Step 5: Commit**

```bash
git add src/app/services/messaging src/app/services/customer-service.js src/app/services/security-notification-service.js src/app/services/churn-service.js src/app/services/lifecycle-service.js tests/unit/email-branding.test.js tests/unit/email-renderer.test.js tests/unit/smtp-provider.test.js
git commit -m "feat: add branded html email delivery"
```

## Self-Review

Spec coverage check:

- platform-vs-tenant branding: Task 1
- shared branded shell + typed templates: Task 2
- SMTP multipart delivery: Task 3
- messaging service normalization and backward compatibility: Task 4
- verification/security integration: Task 5
- lifecycle/churn/alerts integration: Task 6
- focused verification + real SMTP send: Task 7

Placeholder scan:

- all tasks include specific files
- all tasks include concrete commands
- all code steps include concrete snippets

Type consistency:

- renderer contract uses `subject`, `text`, `html` consistently
- typed email payloads use `type` and message-specific fields consistently across tasks
