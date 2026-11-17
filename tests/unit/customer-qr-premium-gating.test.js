import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createQrController, shouldEmbedQrLogo, waitForQrLogoAsset } from "../../public/customer/qr.js";

describe("customer qr premium gating", () => {
  it("rejects embedding below EMPRESA", () => {
    assert.equal(
      shouldEmbedQrLogo({
        plan: "NEGOCIO",
        logoUrl: "https://cdn.example.com/logo.png",
        enabled: true
      }),
      false
    );
  });

  it("rejects embedding without an absolute logo URL", () => {
    assert.equal(
      shouldEmbedQrLogo({
        plan: "EMPRESA",
        logoUrl: "/assets/logo.png",
        enabled: true
      }),
      false
    );
  });

  it("rejects embedding when the owner toggle is off", () => {
    assert.equal(
      shouldEmbedQrLogo({
        plan: "EMPRESA",
        logoUrl: "https://cdn.example.com/logo.png",
        enabled: false
      }),
      false
    );
  });

  it("rejects embedding when the feature is disabled or the logo is missing", () => {
    assert.equal(
      shouldEmbedQrLogo({
        plan: "EMPRESA",
        logoUrl: "",
        enabled: true
      }),
      false
    );
    assert.equal(
      shouldEmbedQrLogo({
        plan: "EMPRESA",
        logoUrl: "https://cdn.example.com/logo.png",
        enabled: false
      }),
      false
    );
  });

  it("allows embedding only for EMPRESA with a logo and explicit enablement", () => {
    assert.equal(
      shouldEmbedQrLogo({
        plan: "EMPRESA",
        logoUrl: "https://cdn.example.com/logo.png",
        enabled: true
      }),
      true
    );
  });

  it("keeps the QR plain when the premium logo asset does not load", async () => {
    class BrokenImage {
      constructor() {
        /** @type {((error?: unknown) => void) | null} */
        this.onerror = null;
        /** @type {(() => void) | null} */
        this.onload = null;
      }

      set src(_value) {
        queueMicrotask(() => this.onerror?.(new Error("load failed")));
      }
    }

    assert.equal(
      await waitForQrLogoAsset("https://cdn.example.com/logo.png", {
        ImageCtor: /** @type {typeof Image} */ (/** @type {unknown} */ (BrokenImage)),
        timeoutMs: 25
      }),
      false
    );
  });

  it("allows decoration only after the premium logo asset loads", async () => {
    class GoodImage {
      constructor() {
        /** @type {((error?: unknown) => void) | null} */
        this.onerror = null;
        /** @type {(() => void) | null} */
        this.onload = null;
      }

      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    }

    assert.equal(
      await waitForQrLogoAsset("https://cdn.example.com/logo.png", {
        ImageCtor: /** @type {typeof Image} */ (/** @type {unknown} */ (GoodImage)),
        timeoutMs: 25
      }),
      true
    );
  });
});

it("disposed QR controllers ignore a response that finishes after logout", async t => {
  const messages = [];
  let finish = /** @type {(value: Response) => void} */ (() => {});
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { finish = resolve; }));
  const controller = createQrController({ $: () => null, toast: message => messages.push(message) });
  const pending = controller.generateQR();
  controller.dispose();
  finish(new Response("<svg />"));
  await pending;
  assert.deepEqual(messages, []);
});

it("QR renewal never starts overlapping requests", async t => {
  let calls = 0;
  let finish = /** @type {(value: Response) => void} */ (() => {});
  t.mock.method(globalThis, "fetch", () => { calls += 1; return new Promise(resolve => { finish = resolve; }); });
  const controller = createQrController({ $: () => null, toast() {} });
  const pending = controller.generateQR();
  const duplicate = controller.generateQR();
  assert.equal(calls, 1);
  finish(new Response("Expired", { status: 401 }));
  await Promise.all([pending, duplicate]);
  controller.dispose();
});

it("an ended session while generating a QR follows the session-expired flow instead of showing the response body", async t => {
  const messages = [];
  let expired = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "No autenticado", code: "AUTH_REQUIRED", request_id: "abc" }), { status: 401, headers: { "Content-Type": "application/json" } }));
  const controller = createQrController({ $: () => null, toast: message => messages.push(message), onSessionExpired: () => { expired += 1; } });
  await controller.generateQR();
  assert.equal(expired, 1);
  assert.deepEqual(messages, []);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Customer not found", code: "CUSTOMER_NOT_FOUND" }), { status: 404 }));
  await controller.generateQR();
  assert.equal(expired, 2);
  assert.deepEqual(messages, []);
});

it("QR failures show friendly Spanish messages, never raw JSON", async t => {
  const messages = [];
  const controller = createQrController({ $: () => null, toast: message => messages.push(message), onSessionExpired: () => assert.fail("not a session error") });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in 30 seconds.", code: "RATE_LIMITED" }), { status: 429 }));
  await controller.generateQR();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Error interno del servidor", code: "INTERNAL_ERROR" }), { status: 500 }));
  await controller.generateQR();
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  await controller.generateQR();
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await controller.generateQR();
  controller.dispose();
  assert.deepEqual(messages, [
    "Generaste varios QR seguidos. Espera un momento e inténtalo de nuevo.",
    "No se pudo generar tu QR. Inténtalo de nuevo en un momento.",
    "No se pudo generar tu QR. Inténtalo de nuevo en un momento.",
    "No se pudo generar tu QR. Revisa tu conexión e inténtalo de nuevo."
  ]);
  assert.ok(messages.every(message => !/[{}]|error|HTTP|html/i.test(message)));
});
