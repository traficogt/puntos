process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://app.test";
process.env.CORS_ORIGIN = "http://app.test,http://alt.test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { csrfProtect } = await import("../../src/middleware/csrf.js");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function baseReq(overrides = {}) {
  return {
    method: "POST",
    cookies: { pf_csrf: "token-123" },
    headers: { "x-csrf-token": "token-123", origin: "http://app.test" },
    originalUrl: "/api/test",
    url: "/api/test",
    body: {},
    protocol: "http",
    get(name) {
      if (String(name).toLowerCase() === "host") return "app.test";
      return undefined;
    },
    ...overrides
  };
}

describe("csrf security", () => {
  it("allows matching trusted origins", async () => {
    const req = baseReq();
    const res = makeRes();
    let called = false;

    await csrfProtect(req, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  });

  it("allows trusted referer when origin is absent", async () => {
    const req = baseReq({
      headers: {
        "x-csrf-token": "token-123",
        referer: "http://alt.test/admin"
      }
    });
    const res = makeRes();
    let called = false;

    await csrfProtect(req, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  });

  it("allows exact same-origin requests even when not in the configured allowlist", async () => {
    const req = baseReq({
      protocol: "http",
      get(name) {
        if (String(name).toLowerCase() === "host") return "localhost:3001";
        return undefined;
      },
      headers: {
        "x-csrf-token": "token-123",
        origin: "http://localhost:3001"
      }
    });
    const res = makeRes();
    let called = false;

    await csrfProtect(req, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  });

  it("rejects missing origin and referer", async () => {
    const req = baseReq({
      headers: { "x-csrf-token": "token-123" }
    });
    const res = makeRes();
    let called = false;

    await csrfProtect(req, res, () => {
      called = true;
    });

    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Origen de solicitud inválido" });
  });

  it("rejects mismatched origin", async () => {
    const req = baseReq({
      headers: {
        "x-csrf-token": "token-123",
        origin: "https://evil.example"
      }
    });
    const res = makeRes();
    let called = false;

    await csrfProtect(req, res, () => {
      called = true;
    });

    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Origen de solicitud inválido" });
  });
});
