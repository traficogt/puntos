import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldEmbedQrLogo, waitForQrLogoAsset } from "../../public/customer/qr.js";

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
