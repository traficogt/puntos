import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorHandler, notFound } from "../../src/middleware/common.js";

function fakeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(k, v) {
      headers.set(String(k).toLowerCase(), String(v));
    },
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

describe("middleware/common", () => {
  it("returns localized 404 with code and request id", () => {
    const res = fakeRes();
    notFound({ id: "req-404", headers: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body?.code, "NOT_FOUND");
    assert.equal(res.body?.error, "No encontrado");
    assert.equal(res.body?.request_id, "req-404");
    assert.equal(res.headers.get("x-request-id"), "req-404");
  });

  it("maps auth errors to AUTH_REQUIRED code", () => {
    const res = fakeRes();
    errorHandler({ statusCode: 401, message: "No autenticado" }, { id: "req-auth", headers: {}, log: { error() {} } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "AUTH_REQUIRED");
    assert.equal(res.body?.request_id, "req-auth");
  });

  it("treats JSON parse failures as BAD_JSON with 400", () => {
    const res = fakeRes();
    errorHandler({ status: 400, type: "entity.parse.failed", message: "Unexpected token" }, { id: "req-json", headers: {}, log: { error() {} } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, "BAD_JSON");
    assert.equal(res.body?.error, "JSON invalido");
  });
});
