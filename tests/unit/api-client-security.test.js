import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../../public/lib.js";

test("custom request headers retain both CSRF and JSON defaults", async t => {
  const prior = globalThis.document;
  globalThis.document = /** @type {any} */ ({ cookie: "pf_csrf_readable=sandbox-csrf" });
  t.after(() => { globalThis.document = prior; });
  /** @type {RequestInit} */
  let observed = {};
  t.mock.method(globalThis, "fetch", async (_path, options) => { observed = options; return new Response('{"ok":true}'); });
  await api("/api/customer/action", { method: "POST", headers: new Headers({ "X-Custom": "yes" }), body: "{}" });
  const headers = new Headers(observed.headers);
  assert.equal(headers.get("x-csrf-token"), "sandbox-csrf");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-custom"), "yes");
});

test("API errors preserve numeric HTTP status for auth/offline decisions", async t => {
  const prior = globalThis.document;
  globalThis.document = /** @type {any} */ ({ cookie: "" });
  t.after(() => { globalThis.document = prior; });
  t.mock.method(globalThis, "fetch", async () => new Response('{"error":"No autenticado","code":"AUTH_INVALID_SESSION"}', { status: 401 }));
  await assert.rejects(api("/api/customer/me"), error => {
    const responseError = /** @type {Error & {status?: number, code?: string}} */ (error);
    return responseError.status === 401 && responseError.code === "AUTH_INVALID_SESSION";
  });
});
