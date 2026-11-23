import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { config } from "../../src/config/index.js";
import { errorHandler, notFound } from "../../src/middleware/common.js";
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  inferErrorCode,
  isApiErrorCode,
  notFound as notFoundError,
  tooManyRequests,
  unauthorized,
} from "../../src/utils/http-error.js";

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
    },
  };
}

/**
 * @param {string} id
 * @param {{ error?: (...args: any[]) => void; info?: (...args: any[]) => void }} [log]
 */
function fakeReq(id, log = { error() {}, info() {} }) {
  return { id, headers: {}, log, method: "GET", originalUrl: "/api/test" };
}

function withNodeEnv(env, fn) {
  const previous = config.NODE_ENV;
  config.NODE_ENV = env;
  try {
    return fn();
  } finally {
    config.NODE_ENV = previous;
  }
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
    errorHandler(
      { statusCode: 401, message: "No autenticado" },
      { id: "req-auth", headers: {}, log: { error() {} } },
      res,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "AUTH_REQUIRED");
    assert.equal(res.body?.request_id, "req-auth");
  });

  it("treats JSON parse failures as BAD_JSON with 400", () => {
    const res = fakeRes();
    errorHandler(
      { status: 400, type: "entity.parse.failed", message: "Unexpected token" },
      { id: "req-json", headers: {}, log: { error() {} } },
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, "BAD_JSON");
    assert.equal(res.body?.error, "JSON invalido");
  });

  it("lets an explicit API code on an HttpError win over message inference", () => {
    const res = fakeRes();
    // The message would infer NOT_FOUND; the explicit code must be used instead.
    errorHandler(
      new HttpError(404, "Cliente no encontrado", "CUSTOMER_NOT_FOUND"),
      fakeReq("req-1"),
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
      error: "Cliente no encontrado",
      code: "CUSTOMER_NOT_FOUND",
      request_id: "req-1",
    });
    assert.equal(res.headers.get("x-request-id"), "req-1");
  });

  it("falls back to legacy inference for errors without a usable code", () => {
    const res = fakeRes();
    errorHandler({ statusCode: 409, message: "Reward out of stock" }, fakeReq("req-2"), res);
    assert.equal(res.body?.code, "CONFLICT");

    const invalid = fakeRes();
    errorHandler({ statusCode: 400, message: "Invalid QR token" }, fakeReq("req-3"), invalid);
    assert.equal(invalid.body?.code, "VALIDATION_ERROR");

    // SQLSTATE and Node system codes are internal; they never become API codes.
    const pg = fakeRes();
    errorHandler(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
      fakeReq("req-4"),
      pg,
    );
    assert.equal(pg.statusCode, 500);
    assert.equal(pg.body?.code, "INTERNAL_ERROR");
    const sys = fakeRes();
    errorHandler(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      fakeReq("req-5"),
      sys,
    );
    assert.equal(sys.body?.code, "INTERNAL_ERROR");
  });

  it("turns a ZodError that escaped a handler into a 400 VALIDATION_ERROR with field details", () => {
    const res = fakeRes();
    const schema = z.object({ phone: z.string().min(8), amount: z.number().positive() });
    let zodError;
    try {
      schema.parse({ phone: "123", amount: -1 });
    } catch (error) {
      zodError = error;
    }
    errorHandler(zodError, fakeReq("req-zod"), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, "VALIDATION_ERROR");
    assert.equal(res.body?.error, "Revisa los datos enviados.");
    assert.equal(res.body?.request_id, "req-zod");
    assert.deepEqual(
      res.body?.details.map((d) => d.field),
      ["phone", "amount"],
    );
    assert.ok(res.body.details.every((d) => typeof d.message === "string" && d.message));
  });

  it("masks unknown errors as 500 INTERNAL_ERROR in production without leaking the message", () => {
    const res = fakeRes();
    const logged = [];
    withNodeEnv("production", () => {
      errorHandler(
        new Error('relation "secret_table" does not exist'),
        fakeReq("req-500", {
          error: (ctx, msg) => {
            logged.push({ ctx, msg });
          },
          info() {},
        }),
        res,
      );
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
      error: "Error interno del servidor",
      code: "INTERNAL_ERROR",
      request_id: "req-500",
    });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].msg, "Unhandled error");
    assert.equal(logged[0].ctx.status, 500);

    // Outside production the original message is still returned for debugging.
    const dev = fakeRes();
    withNodeEnv("test", () => {
      errorHandler(new Error("boom"), fakeReq("req-dev"), dev);
    });
    assert.equal(dev.statusCode, 500);
    assert.equal(dev.body?.error, "boom");
    assert.equal(dev.body?.code, "INTERNAL_ERROR");
  });
});

describe("utils/http-error", () => {
  it("gives HttpError a stable code, status and statusCode", () => {
    const err = new HttpError(409, "Este correo ya está en uso");
    assert.equal(err.name, "HttpError");
    assert.equal(err.statusCode, 409);
    assert.equal(err.status, 409);
    assert.equal(err.code, "CONFLICT");
    assert.ok(err instanceof Error);

    const explicit = new HttpError(404, "Cliente no encontrado", "CUSTOMER_NOT_FOUND");
    assert.equal(explicit.code, "CUSTOMER_NOT_FOUND");
    // Malformed explicit codes are ignored in favour of the derived one.
    assert.equal(new HttpError(404, "x", "not-a-code").code, "NOT_FOUND");
  });

  it("derives sensible default codes from the factory helpers", () => {
    assert.equal(badRequest("Falta el correo").code, "BAD_REQUEST");
    assert.equal(unauthorized().code, "AUTH_REQUIRED");
    assert.equal(forbidden("La recompensa pertenece a otro negocio").code, "FORBIDDEN");
    assert.equal(notFoundError().code, "NOT_FOUND");
    assert.equal(conflict("Puntos insuficientes").code, "CONFLICT");
    assert.equal(tooManyRequests().code, "RATE_LIMITED");
    assert.equal(badRequest("Código QR no válido", "VALIDATION_ERROR").code, "VALIDATION_ERROR");
    assert.deepEqual(
      [badRequest, unauthorized, forbidden, notFoundError, conflict, tooManyRequests].map(
        (factory) => factory().message,
      ),
      [
        "Solicitud no válida",
        "No autenticado",
        "No autorizado",
        "No encontrado",
        "Conflicto con el estado actual",
        "Demasiadas solicitudes",
      ],
    );
  });

  it("keeps the legacy message inference for untranslated English messages", () => {
    assert.equal(inferErrorCode("Invalid credentials", 401), "VALIDATION_ERROR");
    assert.equal(inferErrorCode("Not authenticated", 401), "AUTH_REQUIRED");
    assert.equal(inferErrorCode("Customer not found", 404), "NOT_FOUND");
    assert.equal(inferErrorCode("Cliente no encontrado", 404), "NOT_FOUND");
    assert.equal(
      inferErrorCode("Feature 'x' not available in current plan", 403),
      "PLAN_FEATURE_LOCKED",
    );
    assert.equal(inferErrorCode("Puntos insuficientes", 409), "CONFLICT");
    assert.equal(inferErrorCode("", 500), "INTERNAL_ERROR");
    assert.equal(inferErrorCode("", 418), "UNEXPECTED_ERROR");
  });

  it("recognises API codes and rejects internal ones", () => {
    for (const ok of ["NOT_FOUND", "CUSTOMER_NOT_FOUND", "SALE_400", "X"])
      assert.ok(isApiErrorCode(ok), ok);
    for (const bad of [
      "23505",
      "ECONNREFUSED",
      "ERR_INVALID_ARG_TYPE",
      "not_found",
      "",
      null,
      42,
      "Not Found",
    ])
      assert.equal(isApiErrorCode(bad), false, String(bad));
  });
});
