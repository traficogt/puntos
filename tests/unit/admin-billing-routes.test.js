import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminBillingRoutes } from "../../src/app/routes/admin/billing.js";
import { requireStaff } from "../../src/middleware/auth.js";
import { pool } from "../../src/app/database.js";

// Daily sums as PostgreSQL hands them over: numeric(10,2) strings.
let dailyRows = [];
let lastParams = null;
let lastSql = "";
pool.query = async (sql, params) => {
  const text = String(sql);
  if (text.includes("FROM transactions t")) {
    lastParams = params;
    lastSql = text;
    return { rows: dailyRows, rowCount: dailyRows.length };
  }
  return { rows: [], rowCount: 0 };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runRoute(routePath, req) {
  const layer = adminBillingRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = /** @type {any} */ (makeRes());
  // The session-cookie check is exercised elsewhere; the request already carries
  // an authenticated owner so requireOwner, tenantContext and the route run.
  const handlers = layer.route.stack
    .map((entry) => entry.handle)
    .filter((handler) => handler !== requireStaff);
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      try {
        const maybe = handler(req, res, (err) => (err ? reject(err) : resolve(undefined)));
        if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
        else if (handler.length < 3) resolve(undefined);
      } catch (error) {
        reject(error);
      }
    });
  }
  return res;
}

const ivaCsv = (query = {}) =>
  runRoute("/admin/billing/iva.csv", {
    method: "GET",
    path: "/admin/billing/iva.csv",
    url: "/admin/billing/iva.csv",
    originalUrl: "/admin/billing/iva.csv",
    query,
    staff: { id: "staff-1", business_id: "biz-1", role: "OWNER" },
  });

describe("admin billing IVA csv", () => {
  it("splits three sales of 19.99 into an exact base and 12% IVA", async () => {
    dailyRows = [{ fecha: "2026-11-02", transacciones: 3, monto_bruto_q: "59.97" }];
    const res = await ivaCsv();
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(res.headers["Content-Disposition"], /reporte_iva_gt\.csv/);
    const lines = String(res.body).trim().split(/\r?\n/);
    assert.deepEqual(lines, [
      "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q",
      // 59.97 / 1.12 = 53.5446... -> 53.54; IVA is the remainder, 6.43.
      "2026-11-02,3,59.97,53.54,6.43",
    ]);
    // The date is formatted in SQL: a DATE column would otherwise serialize as an ISO timestamp.
    assert.match(lastSql, /to_char\(t\.created_at::date, 'YYYY-MM-DD'\) AS fecha/);
  });

  it("keeps bruto = base + IVA on every row, including exact .xx5 ties", async () => {
    dailyRows = [
      { fecha: "2026-11-01", transacciones: 1, monto_bruto_q: "0.42" }, // base 0.375 -> 0.38
      { fecha: "2026-11-03", transacciones: 1, monto_bruto_q: "0.14" },
      { fecha: "2026-11-04", transacciones: 2, monto_bruto_q: "112.00" },
      { fecha: "2026-11-05", transacciones: 4, monto_bruto_q: "1000.00" },
      { fecha: "2026-11-06", transacciones: 0, monto_bruto_q: "0.00" },
      { fecha: "2026-11-07", transacciones: 1, monto_bruto_q: "99999999.99" },
    ];
    const res = await ivaCsv();
    const lines = String(res.body).trim().split(/\r?\n/);
    assert.deepEqual(lines, [
      "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q",
      "2026-11-01,1,0.42,0.38,0.04",
      "2026-11-03,1,0.14,0.13,0.01",
      "2026-11-04,2,112.00,100.00,12.00",
      "2026-11-05,4,1000.00,892.86,107.14",
      "2026-11-06,0,0.00,0.00,0.00",
      "2026-11-07,1,99999999.99,89285714.28,10714285.71",
    ]);
    for (const line of lines.slice(1)) {
      const [, , gross, base, iva] = line.split(",");
      assert.equal(
        Math.round(Number(base) * 100) + Math.round(Number(iva) * 100),
        Math.round(Number(gross) * 100),
        `row does not add up: ${line}`,
      );
    }
  });

  it("passes the optional date window through as SQL parameters", async () => {
    dailyRows = [];
    const res = await ivaCsv({ from: "2026-11-01", to: "2026-11-30" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(lastParams, ["biz-1", "2026-11-01", "2026-11-30"]);
    assert.equal(
      String(res.body).trim(),
      "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q",
    );
  });
});
