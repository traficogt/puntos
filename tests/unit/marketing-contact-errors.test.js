import test from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  NODE_ENV: "test", DB_HOST: "localhost", DB_NAME: "puntos", DB_USER: "puntos", DB_PASSWORD_FILE: "",
  DB_PASSWORD: "test-db-password-12345", JWT_SECRET_FILE: "", JWT_SECRET: "test-jwt-secret-abcdefghijklmnopqrstuvwxyz"
});

const indexUrl = new URL("../../public/index.js", import.meta.url).href;
let loads = 0;

function control(id) {
  const attributes = new Map();
  return {
    id, value: "", textContent: "", className: "", disabled: false, focused: 0,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name) ?? null,
    focus() { this.focused += 1; }
  };
}

/** Runs the marketing script against a minimal page with only the demo form. */
async function mountContactForm(t, respond) {
  const ids = ["cfName", "cfBusiness", "cfContact", "cfLocations", "cfMessage", "contactSubmit", "contactStatus"];
  const elements = Object.fromEntries(ids.map(id => [id, control(id)]));
  const token = { value: "verified-token" };
  const listeners = new Map();
  const form = { addEventListener: (name, handler) => listeners.set(name, handler), querySelector: selector => selector.includes("cf-turnstile-response") ? token : null, reset() {} };
  elements.contactForm = /** @type {any} */ (form);
  const resets = [];
  const requests = [];
  for (const [key, value] of Object.entries({
    document: { getElementById: id => elements[id] ?? null, querySelector: () => null },
    window: { turnstile: { reset: () => resets.push(true) } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  t.mock.method(globalThis, "fetch", async (_url, options) => { requests.push(JSON.parse(options.body)); return respond(); });
  const module = await import(`${indexUrl}?case=${++loads}`);
  const fill = values => { for (const [id, value] of Object.entries(values)) elements[id].value = value; };
  fill({ cfName: "Ana López", cfBusiness: "Café de prueba", cfContact: "ana@example.com", cfMessage: "Organizar el programa de lealtad." });
  const submit = () => listeners.get("submit")({ preventDefault() {} });
  return { module, elements, fill, submit, requests, resets, status: () => elements.contactStatus.textContent };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("the demo form rejects a message shorter than the server minimum before sending", async t => {
  const h = await mountContactForm(t, () => json(200, { ok: true }));
  h.fill({ cfMessage: "Hola" });
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(h.status(), /al menos 10 caracteres/);
  assert.equal(h.elements.cfMessage.getAttribute("aria-invalid"), "true");
  assert.equal(h.elements.cfMessage.focused, 1);
  h.fill({ cfMessage: "x".repeat(1990), cfLocations: "Dos sucursales en la zona 10" });
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(h.status(), /superan 2000 caracteres/);
});

test("demo request failures explain rate limits, verification and server validation in Spanish", async t => {
  const responses = [
    json(429, { error: "Too many attempts. Try again in 900 seconds.", code: "RATE_LIMITED" }),
    json(400, { error: "Verificación fallida. Intenta de nuevo.", code: "VERIFICATION_FAILED" }),
    json(400, { error: { formErrors: [], fieldErrors: { message: ["Too small: expected string to have >=10 characters"] } }, code: "VALIDATION_ERROR" }),
    json(502, { error: "No se pudo enviar el mensaje. Intenta de nuevo en unos minutos." }),
    new Response("<html>Bad gateway</html>", { status: 502 })
  ];
  const h = await mountContactForm(t, () => responses.shift());
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await h.submit();
    seen.push(h.status());
    assert.equal(h.elements.contactSubmit.disabled, false);
  }
  assert.deepEqual(seen, [
    "Recibimos varias solicitudes desde tu conexión. Espera unos minutos e inténtalo de nuevo.",
    "No pudimos confirmar la verificación. Complétala de nuevo y envía tu solicitud.",
    "Cuéntanos qué quieres resolver con al menos 10 caracteres y hasta 2000.",
    "No se pudo enviar el mensaje. Intenta de nuevo en unos minutos.",
    "No pudimos enviar tu solicitud. Inténtalo de nuevo en unos minutos."
  ]);
  assert.equal(h.elements.cfMessage.getAttribute("aria-invalid"), "true");
  assert.equal(h.resets.length, 5);
  assert.equal(h.requests[0].turnstileToken, "verified-token");
});

test("contact failure mapping never exposes English validation details", async t => {
  const { module } = await mountContactForm(t, () => json(200, { ok: true }));
  for (const field of ["name", "business", "contact"]) {
    const failure = module.contactFailure(400, { error: { formErrors: [], fieldErrors: { [field]: ["Too big"] } } });
    assert.doesNotMatch(failure.message, /Too big/);
    assert.match(failure.field, /^cf/);
  }
  assert.equal(module.contactFailure(400, { error: { formErrors: ["Invalid input"], fieldErrors: {} } }).message, "No pudimos enviar tu solicitud. Inténtalo de nuevo en unos minutos.");
});

function routeHandler(router, path) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route?.methods?.post);
  assert.ok(layer, `Expected POST ${path}`);
  return layer.route.stack.at(-1).handle;
}

async function post(handler, body) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await new Promise((resolve, reject) => {
    const next = error => error ? reject(error) : resolve(undefined);
    Promise.resolve(handler({ body, headers: {}, get: () => "puntosfieles.com", socket: {}, ip: "127.0.0.1" }, res, next)).then(resolve, reject);
  });
  return res;
}

test("the contact endpoint labels validation and verification failures with stable codes", async t => {
  const { publicRoutes } = await import("../../src/app/routes/public-routes.js");
  const { config } = await import("../../src/config/index.js");
  const handler = routeHandler(publicRoutes, "/public/contact");
  const valid = { name: "Ana", business: "Café", contact: "ana@example.com", message: "Organizar el programa.", turnstileToken: "token" };
  const short = await post(handler, { ...valid, message: "Hola" });
  assert.equal(short.statusCode, 400);
  assert.equal(short.body.code, "VALIDATION_ERROR");
  assert.ok(short.body.error.fieldErrors.message.length > 0);
  const previousSecret = config.CONTACT_TURNSTILE_SECRET;
  config.CONTACT_TURNSTILE_SECRET = "test-secret";
  t.after(() => { config.CONTACT_TURNSTILE_SECRET = previousSecret; });
  // A fake verification provider rejects the token; no external request is made.
  t.mock.method(globalThis, "fetch", async () => json(200, { success: false }));
  const rejected = await post(handler, valid);
  assert.equal(rejected.statusCode, 400);
  assert.deepEqual(rejected.body, { error: "Verificación fallida. Intenta de nuevo.", code: "VERIFICATION_FAILED" });
});
