# Customer Auth And Message Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split customer registration and login cleanly while introducing a fallback-capable verification delivery router with SMTP baseline support and optional WhatsApp/Twilio adapters.

**Architecture:** Keep one app-level `sendMessage()` entry point, but move provider-specific logic behind isolated adapters and a delivery router that can try multiple eligible providers in order. On the product side, keep customer identity phone-first, add optional email as a delivery fallback field, create a dedicated `/ingresar/:slug` route, and keep `/c` wallet-only with Spanish-first errors.

**Tech Stack:** Node.js, Express, Zod, Nodemailer, browser ES modules, Node test runner, existing PuntosFieles routing/auth stack

---

## File Structure

### Messaging backend

- Modify: `src/config/index.js`
  - add ordered provider config, WAHA/Twilio/Baileys settings, and SMTP no-auth support
- Modify: `src/app/services/messaging-service.js`
  - convert from single global switch to router entry point
- Create: `src/app/services/messaging/message-router.js`
  - choose eligible providers and attempt them in order
- Create: `src/app/services/messaging/providers/dev-provider.js`
- Create: `src/app/services/messaging/providers/smtp-provider.js`
- Create: `src/app/services/messaging/providers/whatsapp-cloud-provider.js`
- Create: `src/app/services/messaging/providers/waha-provider.js`
- Create: `src/app/services/messaging/providers/twilio-provider.js`
- Create: `src/app/services/messaging/providers/baileys-provider.js`
  - adapter boundary only; implementation may delegate to configured HTTP bridge or remain unavailable if not configured

### Customer verification backend

- Modify: `src/utils/schemas.js`
  - allow optional verification email
- Modify: `src/app/services/customer-service.js`
  - accept optional email, pass destinations to router, normalize Spanish errors
- Modify: `src/app/routes/public-routes.js`
  - keep customer-facing join/auth errors Spanish-first

### Customer frontend

- Create: `public/customer-auth-entry.js`
  - shared controller for registration/login code request + verification
- Modify: `public/join.html`
  - first-time activation framing only
- Modify: `public/join.js`
  - delegate to shared auth-entry controller in `register` mode
- Create: `public/ingresar.html`
  - returning customer login page
- Create: `public/ingresar.js`
  - delegate to shared auth-entry controller in `login` mode
- Modify: `public/customer.html`
  - wallet-only fallback text should mention `ingresar`
- Modify: `public/customer/load.js`
  - redirect missing session to `/ingresar/:slug`
- Modify: `public/customer/index.js`
  - logout should send customer to `/ingresar/:slug?motivo=salida`
- Modify: `public/lib.js`
  - expand Spanish auth/message error normalization
- Modify: `public/styles/pages.css`
  - style the new login page and any updated copy blocks
- Modify: `public/sw.js`
  - precache/route `ingresar.html` if needed

### Routing

- Modify: `src/app/server.js`
  - serve `/ingresar/:slug`
  - keep `/registro/:slug`
  - keep `/c` wallet-only
- Modify: `src/utils/app-host-routing.js`
  - keep customer-facing paths under app host and ensure host redirect rules include `/ingresar/:slug`

### Tests

- Create: `tests/unit/message-router.test.js`
- Create: `tests/unit/smtp-provider.test.js`
- Create: `tests/unit/customer-login-route-contract.test.js`
- Modify: `tests/unit/customer-entry-feedback-contract.test.js`
- Modify: `tests/unit/customer-route-language-contract.test.js`
- Modify: `tests/unit/join-feedback-contract.test.js`
- Modify: `tests/unit/runtime-config-route-contract.test.js`
- Modify: `tests/unit/app-host-routing.test.js`

### Docs/config examples

- Modify: `.env.example`
- Modify: `.env`
  - only if the local development config should use SMTP defaults immediately
- Modify: `docs/2026-04-02-customer-auth-and-message-routing-design.md`
  - only if implementation reveals a naming mismatch

---

### Task 1: Build the delivery router and provider adapters

**Files:**
- Create: `src/app/services/messaging/message-router.js`
- Create: `src/app/services/messaging/providers/dev-provider.js`
- Create: `src/app/services/messaging/providers/smtp-provider.js`
- Create: `src/app/services/messaging/providers/whatsapp-cloud-provider.js`
- Create: `src/app/services/messaging/providers/waha-provider.js`
- Create: `src/app/services/messaging/providers/twilio-provider.js`
- Create: `src/app/services/messaging/providers/baileys-provider.js`
- Modify: `src/app/services/messaging-service.js`
- Modify: `src/config/index.js`
- Test: `tests/unit/message-router.test.js`
- Test: `tests/unit/smtp-provider.test.js`

- [ ] **Step 1: Write the failing router tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createMessageRouter } from "../../src/app/services/messaging/message-router.js";

test("tries eligible providers in order and stops on first success", async () => {
  const attempts = [];
  const router = createMessageRouter({
    order: ["waha", "smtp_email"],
    providers: {
      waha: { canSend: () => true, send: async () => { attempts.push("waha"); throw new Error("down"); } },
      smtp_email: { canSend: () => true, send: async () => { attempts.push("smtp_email"); return { ok: true, providerId: "smtp-1" }; } }
    }
  });

  const out = await router.send({ channel: "verify", destinations: { phone: "+50255555555", email: "x@test.com" }, body: "hola" });
  assert.equal(out.ok, true);
  assert.deepEqual(attempts, ["waha", "smtp_email"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/unit/message-router.test.js tests/unit/smtp-provider.test.js
```

Expected:
- FAIL because the router/adapters do not exist yet

- [ ] **Step 3: Add config for ordered providers and provider credentials**

Update `src/config/index.js` with config keys like:

```js
MESSAGE_PROVIDER: process.env.MESSAGE_PROVIDER ?? "dev",
MESSAGE_PROVIDER_ORDER: parseCsv(envValue("MESSAGE_PROVIDER_ORDER", "dev")),
WAHA_BASE_URL: envValue("WAHA_BASE_URL", ""),
WAHA_API_KEY: envValue("WAHA_API_KEY", ""),
WAHA_SESSION: envValue("WAHA_SESSION", "default"),
BAILEYS_BASE_URL: envValue("BAILEYS_BASE_URL", ""),
BAILEYS_API_KEY: envValue("BAILEYS_API_KEY", ""),
TWILIO_ACCOUNT_SID: envValue("TWILIO_ACCOUNT_SID", ""),
TWILIO_AUTH_TOKEN: envValue("TWILIO_AUTH_TOKEN", ""),
TWILIO_WHATSAPP_FROM: envValue("TWILIO_WHATSAPP_FROM", ""),
SMTP_HOST: envValue("SMTP_HOST", ""),
SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
SMTP_USER: envValue("SMTP_USER", ""),
SMTP_PASS: envValue("SMTP_PASS", ""),
SMTP_SECURE: (process.env.SMTP_SECURE ?? "auto"),
```

And in the SMTP adapter use:

```js
const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE === "true" ? true : config.SMTP_SECURE === "false" ? false : config.SMTP_PORT === 465,
  ...(config.SMTP_USER || config.SMTP_PASS
    ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
    : {})
});
```

- [ ] **Step 4: Implement the router and adapters with one stable interface**

Use one adapter shape:

```js
export function createSmtpProvider({ config, transportFactory = nodemailer.createTransport }) {
  return {
    name: "smtp_email",
    canSend({ destinations }) {
      return Boolean(destinations?.email && config.SMTP_HOST);
    },
    async send({ to, body }) {
      const transport = transportFactory(/* config */);
      const info = await transport.sendMail({
        from: config.SMTP_FROM,
        to: to.email,
        subject: "PuntosFieles",
        text: body
      });
      return { ok: true, providerId: info.messageId || "smtp" };
    }
  };
}
```

And the router:

```js
export function createMessageRouter({ order, providers }) {
  return {
    async send(payload) {
      const attempts = [];
      for (const name of order) {
        const provider = providers[name];
        if (!provider || !provider.canSend(payload)) continue;
        attempts.push(name);
        try {
          const out = await provider.send(payload);
          return { ok: true, attempts, provider: name, providerId: out.providerId || null };
        } catch (error) {
          // continue to next provider
        }
      }
      return { ok: false, attempts, error: "NO_DELIVERY_PROVIDER" };
    }
  };
}
```

- [ ] **Step 5: Rewire `sendMessage()` to use the router without changing callers**

Keep `sendMessage()` as the public service entry point and adapt it to pass:

```js
const routerResult = await router.send({
  channel,
  body,
  destinations: {
    phone: destinations?.phone || toPhone || null,
    email: destinations?.email || toEmail || null
  }
});
```

Continue to write the message log and billing events there so callers do not change.

- [ ] **Step 6: Run the focused tests and lint**

Run:

```bash
node --test tests/unit/message-router.test.js tests/unit/smtp-provider.test.js
npm run lint
```

Expected:
- PASS for both new unit tests
- PASS for lint

- [ ] **Step 7: Commit**

```bash
git add src/config/index.js src/app/services/messaging-service.js src/app/services/messaging tests/unit/message-router.test.js tests/unit/smtp-provider.test.js
git commit -m "feat: add message router and provider adapters"
```

### Task 2: Extend customer verification to support optional email fallback

**Files:**
- Modify: `src/utils/schemas.js`
- Modify: `src/app/services/customer-service.js`
- Modify: `src/app/routes/public-routes.js`
- Test: `tests/unit/customer-route-language-contract.test.js`

- [ ] **Step 1: Write the failing schema/service tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { requestJoinCodeSchema, verifyJoinCodeSchema } from "../../src/utils/schemas.js";

test("request schema accepts optional email", () => {
  const parsed = requestJoinCodeSchema.parse({ phone: "55555555", email: "cliente@test.com" });
  assert.equal(parsed.email, "cliente@test.com");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/unit/customer-route-language-contract.test.js
```

Expected:
- FAIL because `email` is not accepted yet or route contracts do not match

- [ ] **Step 3: Extend validation schemas**

Update `src/utils/schemas.js`:

```js
export const requestJoinCodeSchema = z.object({
  phone: z.string().min(6),
  email: emailSchema.optional(),
  name: z.string().max(120).optional()
});

export const verifyJoinCodeSchema = z.object({
  phone: z.string().min(6),
  email: emailSchema.optional(),
  code: z.string().min(4).max(10),
  name: z.string().max(120).optional(),
  referralCode: z.string().length(6).optional()
});
```

- [ ] **Step 4: Pass email through customer verification and return Spanish delivery errors**

In `src/app/services/customer-service.js`, change the request path to:

```js
const sent = await sendMessage({
  businessId: business.id,
  customerId: null,
  channel: "verify",
  to: phone,
  destinations: { phone, email: email || null },
  body: `Tu código de PuntosFieles: ${code} (expira en 10 minutos)`
});

if (!sent?.ok) {
  const err = new Error("No se pudo enviar el código por los canales disponibles. Intenta de nuevo en unos minutos.");
  err.statusCode = 503;
  throw err;
}
```

Also normalize backend-raised auth strings in this service to Spanish instead of English where feasible.

- [ ] **Step 5: Keep public route errors Spanish-first**

In `src/app/routes/public-routes.js`, replace direct customer-facing English cases like:

```js
if (!business) return res.status(404).json({ error: "Business not found" });
```

with:

```js
if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
```

Do this at least for customer-facing join/login routes.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --test tests/unit/customer-route-language-contract.test.js
npm run lint
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/schemas.js src/app/services/customer-service.js src/app/routes/public-routes.js tests/unit/customer-route-language-contract.test.js
git commit -m "feat: support email fallback in customer verification"
```

### Task 3: Split customer registration and login into `/registro/:slug` and `/ingresar/:slug`

**Files:**
- Create: `public/customer-auth-entry.js`
- Modify: `public/join.html`
- Modify: `public/join.js`
- Create: `public/ingresar.html`
- Create: `public/ingresar.js`
- Modify: `src/app/server.js`
- Modify: `src/utils/app-host-routing.js`
- Modify: `public/sw.js`
- Test: `tests/unit/customer-login-route-contract.test.js`
- Test: `tests/unit/join-feedback-contract.test.js`
- Test: `tests/unit/runtime-config-route-contract.test.js`
- Test: `tests/unit/app-host-routing.test.js`

- [ ] **Step 1: Write the failing route/UI tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("ingresar route is served by the app shell", () => {
  const html = fs.readFileSync(new URL("../../public/ingresar.html", import.meta.url), "utf8");
  assert.match(html, /Ingresar/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/unit/customer-login-route-contract.test.js tests/unit/join-feedback-contract.test.js tests/unit/runtime-config-route-contract.test.js tests/unit/app-host-routing.test.js
```

Expected:
- FAIL because `/ingresar/:slug` does not exist yet

- [ ] **Step 3: Extract shared auth-entry behavior**

Create `public/customer-auth-entry.js` around a reusable initializer:

```js
export function mountCustomerAuthEntry({ mode, slug, selectors, api, $, toast }) {
  const isLogin = mode === "login";
  // fetch business, update copy, request code, verify code, redirect to /c
}
```

Both `join.js` and `ingresar.js` should call the shared initializer with different copy and done-state text.

- [ ] **Step 4: Add `/ingresar/:slug` route and page**

In `src/app/server.js`:

```js
app.get("/ingresar/:slug", (req, res) => res.sendFile(path.join(publicDir, "ingresar.html")));
```

In `src/utils/app-host-routing.js`, treat `/ingresar/...` like `/registro/...` for app-host routing and marketing-host redirects.

Update `public/sw.js` to know about `ingresar.html` if the service worker precache still includes auth pages.

- [ ] **Step 5: Reframe `join` as first-time activation and `ingresar` as return login**

Examples:

`public/join.html`

```html
<h1 id="title">Activa tu tarjeta</h1>
<p id="subtitle">Ingresa tus datos para abrir tu tarjeta por primera vez.</p>
<a id="existingAccessLink" href="">Ya tengo tarjeta</a>
```

`public/ingresar.html`

```html
<h1 id="title">Ingresa a tu tarjeta</h1>
<p id="subtitle">Te enviaremos un código por WhatsApp o correo, según la configuración del negocio.</p>
<a id="newAccessLink" href="">Todavía no me he registrado</a>
```

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --test tests/unit/customer-login-route-contract.test.js tests/unit/join-feedback-contract.test.js tests/unit/runtime-config-route-contract.test.js tests/unit/app-host-routing.test.js
npm run lint
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add public/customer-auth-entry.js public/join.html public/join.js public/ingresar.html public/ingresar.js src/app/server.js src/utils/app-host-routing.js public/sw.js tests/unit/customer-login-route-contract.test.js tests/unit/join-feedback-contract.test.js tests/unit/runtime-config-route-contract.test.js tests/unit/app-host-routing.test.js
git commit -m "feat: split customer registration and login routes"
```

### Task 4: Make `/c` wallet-only and redirect missing sessions to `/ingresar/:slug`

**Files:**
- Modify: `public/customer.html`
- Modify: `public/customer/load.js`
- Modify: `public/customer/index.js`
- Modify: `public/lib.js`
- Modify: `public/styles/pages.css`
- Test: `tests/unit/customer-entry-feedback-contract.test.js`
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Write the failing wallet-fallback tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("wallet fallback tells the customer to use ingresar, not registro", () => {
  const html = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  assert.match(html, /ingresar/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/unit/customer-entry-feedback-contract.test.js tests/unit/customer-wallet-shell-contract.test.js
```

Expected:
- FAIL because current fallback still points to `registro`

- [ ] **Step 3: Redirect auth failures and logout to `/ingresar/:slug`**

In `public/customer/load.js`:

```js
if (cachedSlug) {
  location.href = `/ingresar/${encodeURIComponent(cachedSlug)}?motivo=sesion-vencida`;
  return;
}
```

In `public/customer/index.js` logout path:

```js
location.href = `/ingresar/${encodeURIComponent(cachedSlug)}?motivo=salida`;
```

- [ ] **Step 4: Expand Spanish auth/message normalization in `public/lib.js`**

Add translations for current backend strings:

```js
err = err.replace(/^Business not found$/i, "Negocio no encontrado");
err = err.replace(/^Phone required$/i, "Falta el teléfono");
err = err.replace(/^Code required$/i, "Falta el código");
err = err.replace(/^No valid code\. Request a new one\.$/i, "No hay un código válido. Solicita uno nuevo.");
err = err.replace(/^Invalid code$/i, "Código inválido");
```

- [ ] **Step 5: Update wallet fallback copy**

In `public/customer.html`, make the empty state say:

```html
No hay formulario aquí. Tu tarjeta se abre desde <code>/ingresar/&lt;slug&gt;</code>. Si esta pantalla apareció sola, vuelve a entrar desde el enlace del negocio.
```

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --test tests/unit/customer-entry-feedback-contract.test.js tests/unit/customer-wallet-shell-contract.test.js
npm run lint
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add public/customer.html public/customer/load.js public/customer/index.js public/lib.js public/styles/pages.css tests/unit/customer-entry-feedback-contract.test.js tests/unit/customer-wallet-shell-contract.test.js
git commit -m "fix: keep customer wallet separate from login flow"
```

### Task 5: Document provider configuration and run the full verification gate

**Files:**
- Modify: `.env.example`
- Modify: `.env`
- Modify: `tests/unit/message-router.test.js`
- Modify: `tests/unit/smtp-provider.test.js`
- Modify: `tests/unit/customer-login-route-contract.test.js`
- Modify: `tests/unit/customer-entry-feedback-contract.test.js`

- [ ] **Step 1: Add concrete env examples for all supported providers**

In `.env.example`, add:

```dotenv
MESSAGE_PROVIDER_ORDER=smtp_email
SMTP_HOST=10.10.1.20
SMTP_PORT=26
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=hola@puntosfieles.com

WAHA_BASE_URL=
WAHA_API_KEY=
WAHA_SESSION=default

BAILEYS_BASE_URL=
BAILEYS_API_KEY=

WA_PHONE_NUMBER_ID=
WA_ACCESS_TOKEN=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
```

- [ ] **Step 2: Align local `.env` only if you want local testing to use SMTP now**

Example local values:

```dotenv
MESSAGE_PROVIDER=smtp_email
MESSAGE_PROVIDER_ORDER=smtp_email
SMTP_HOST=10.10.1.20
SMTP_PORT=26
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
```

If local default should remain `dev`, leave `.env` as-is and document SMTP activation only in `.env.example`.

- [ ] **Step 3: Run focused tests for the new feature area**

Run:

```bash
node --test tests/unit/message-router.test.js tests/unit/smtp-provider.test.js tests/unit/customer-login-route-contract.test.js tests/unit/customer-entry-feedback-contract.test.js tests/unit/customer-route-language-contract.test.js tests/unit/join-feedback-contract.test.js tests/unit/runtime-config-route-contract.test.js tests/unit/app-host-routing.test.js
```

Expected:
- PASS

- [ ] **Step 4: Run repo gates**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration:core
```

Expected:
- PASS on all four commands

- [ ] **Step 5: Manual smoke**

Verify:

```text
1. /registro/test-cafe requests and verifies a code
2. /ingresar/test-cafe requests and verifies a code
3. /c redirects to /ingresar/test-cafe when the session is gone
4. A provider failure falls back to SMTP when email is present
5. Customer-visible errors are Spanish
```

- [ ] **Step 6: Commit**

```bash
git add .env.example .env tests/unit/message-router.test.js tests/unit/smtp-provider.test.js tests/unit/customer-login-route-contract.test.js tests/unit/customer-entry-feedback-contract.test.js tests/unit/customer-route-language-contract.test.js tests/unit/join-feedback-contract.test.js tests/unit/runtime-config-route-contract.test.js tests/unit/app-host-routing.test.js
git commit -m "feat: add customer login flow and routed verification delivery"
```

---

## Self-Review

### Spec coverage

- Delivery router and adapter boundary: covered by Task 1
- SMTP no-auth baseline: covered by Task 1 and Task 5
- Optional email fallback input: covered by Task 2
- `/registro/:slug` vs `/ingresar/:slug`: covered by Task 3
- `/c` wallet-only behavior: covered by Task 4
- Spanish customer auth errors: covered by Tasks 2 and 4
- Testing and rollout safety: covered by Task 5

### Placeholder scan

- No `TBD` or `TODO` markers remain
- Each task includes concrete files, commands, and example code

### Type consistency

- Uses `email` consistently in request payloads
- Uses `/ingresar/:slug` consistently as the returning-customer route
- Keeps `sendMessage()` as the public messaging entry point while routing through the new adapter layer
