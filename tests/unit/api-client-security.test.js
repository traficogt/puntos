import test from "node:test";
import assert from "node:assert/strict";
import { api, readCookieCsrfToken } from "../../public/lib.js";

/**
 * Serves the given JSON responses in order from a mocked `fetch`.
 * @param {import("node:test").TestContext} t
 * @param {Array<{ body?: unknown, status?: number, headers?: Record<string, string> }>} responses
 */
function serve(t, responses) {
  const queue = [...responses];
  t.mock.method(globalThis, "fetch", async () => {
    const { body, status = 400, headers = {} } = queue.shift();
    return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
  });
}

/** @param {Promise<unknown>} promise */
const rejection = (promise) =>
  promise.then(
    () => assert.fail("expected the request to fail"),
    (error) =>
      /** @type {Error & { status?: number, code?: string, requestId?: string }} */ (error),
  );

test("custom request headers retain both CSRF and JSON defaults", async (t) => {
  const prior = globalThis.document;
  globalThis.document = /** @type {any} */ ({ cookie: "pf_csrf_readable=sandbox-csrf" });
  t.after(() => {
    globalThis.document = prior;
  });
  /** @type {RequestInit} */
  let observed = {};
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    observed = options;
    return new Response('{"ok":true}');
  });
  await api("/api/customer/action", {
    method: "POST",
    headers: new Headers({ "X-Custom": "yes" }),
    body: "{}",
  });
  const headers = new Headers(observed.headers);
  assert.equal(headers.get("x-csrf-token"), "sandbox-csrf");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-custom"), "yes");
});

test("API errors preserve numeric HTTP status for auth/offline decisions", async (t) => {
  const prior = globalThis.document;
  globalThis.document = /** @type {any} */ ({ cookie: "" });
  t.after(() => {
    globalThis.document = prior;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response('{"error":"No autenticado","code":"AUTH_INVALID_SESSION"}', { status: 401 }),
  );
  await assert.rejects(api("/api/customer/me"), (error) => {
    const responseError = /** @type {Error & {status?: number, code?: string}} */ (error);
    return responseError.status === 401 && responseError.code === "AUTH_INVALID_SESSION";
  });
});

test("Spanish server messages pass through the English fallback untouched", async (t) => {
  serve(t, [
    { body: { error: "El negocio no existe." }, status: 404 },
    { body: { error: "Espera un momento antes de solicitar otro código." }, status: 429 },
  ]);
  const notFound = await rejection(api("/api/public/business/cafe"));
  assert.equal(notFound.message, "El negocio no existe.");
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, undefined);
  const throttled = await rejection(api("/api/public/business/cafe/join/request-code"));
  assert.equal(throttled.message, "Espera un momento antes de solicitar otro código.");
});

test("English messages from older servers still map to Spanish", async (t) => {
  serve(t, [
    { body: { error: "Business not found" }, status: 404 },
    { body: { error: "Invalid token" }, status: 401 },
    { body: { error: "Feature 'webhooks' not available in current plan" }, status: 403 },
  ]);
  assert.equal((await rejection(api("/x"))).message, "Negocio no encontrado");
  assert.equal((await rejection(api("/x"))).message, "Token invalido");
  assert.equal(
    (await rejection(api("/x"))).message,
    "La funcionalidad 'webhooks' no esta disponible en tu plan actual",
  );
});

test("a known error code is mapped before the message text is considered", async (t) => {
  serve(t, [
    { body: { error: "Business not found", code: "NOT_FOUND" }, status: 404 },
    { body: { error: "Texto propio del servidor", code: "RATE_LIMITED" }, status: 429 },
    { body: { error: "Unmapped text", code: "SUPPORT_CASE_CLOSED" }, status: 409 },
  ]);
  const notFound = await rejection(api("/x"));
  assert.equal(notFound.message, "No encontrado");
  assert.equal(notFound.code, "NOT_FOUND");
  assert.equal(
    (await rejection(api("/x"))).message,
    "Demasiadas solicitudes, intenta de nuevo en un momento",
  );
  const unmapped = await rejection(api("/x"));
  assert.equal(unmapped.message, "Unmapped text");
  assert.equal(unmapped.code, "SUPPORT_CASE_CLOSED");
});

test("rawError keeps the server message and code without mapping or reference suffix", async (t) => {
  const headers = { "x-request-id": "req-123" };
  const coded = { body: { error: "Caso inválido.", code: "NOT_FOUND" }, status: 404, headers };
  serve(t, [
    coded,
    coded,
    { body: { error: "Business not found" }, status: 404, headers },
    { body: {}, status: 500, headers },
    { body: { error: { fieldErrors: { email: ["Correo inválido."] } } }, status: 400 },
  ]);
  const mapped = await rejection(api("/api/public/support/track"));
  assert.equal(mapped.message, "No encontrado (Ref: req-123)");
  assert.equal(mapped.requestId, "req-123");
  const raw = await rejection(api("/api/public/support/track", { rawError: true }));
  assert.equal(raw.message, "Caso inválido.");
  assert.equal(raw.code, "NOT_FOUND");
  assert.equal(raw.status, 404);
  assert.equal(raw.requestId, "req-123");
  assert.equal((await rejection(api("/x", { rawError: true }))).message, "Business not found");
  const silent = await rejection(api("/x", { rawError: true }));
  assert.equal(silent.message, "");
  assert.equal(silent.status, 500);
  assert.equal((await rejection(api("/x", { rawError: true }))).message, "email: Correo inválido.");
});

test("rawError is a client option and never reaches fetch", async (t) => {
  /** @type {RequestInit & { rawError?: boolean }} */
  let observed = {};
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    observed = options;
    return new Response('{"ok":true}');
  });
  assert.deepEqual(await api("/x", { rawError: true, method: "POST", body: "{}" }), { ok: true });
  assert.equal("rawError" in observed, false);
  assert.equal(observed.method, "POST");
});

test("the readable CSRF cookie reader is shared with pages that keep their own transport", async (t) => {
  const prior = globalThis.document;
  t.after(() => {
    globalThis.document = prior;
  });
  globalThis.document = /** @type {any} */ ({
    cookie: "theme=dark; pf_csrf_readable=cookie-token; pf_other=1",
  });
  assert.equal(readCookieCsrfToken(), "cookie-token");
  globalThis.document = /** @type {any} */ ({ cookie: "theme=dark" });
  assert.equal(readCookieCsrfToken(), "");
});
