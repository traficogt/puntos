import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyticsCertificationRoutes } from "../../src/app/routes/analytics/certification.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("FROM businesses")) {
    return {
      rows: [{ id: "biz-1", name: "Cafe GT", slug: "cafe-gt" }],
      rowCount: 1
    };
  }
  if (text.includes("WITH days AS")) {
    return {
      rows: [
        {
          day: "2026-03-01",
          points_issued: 20,
          points_redeemed: 10,
          points_reversed: 0,
          points_expired: 0,
          adjustment_points: 0,
          gift_cards_issued_q: "25.00",
          gift_cards_redeemed_q: "5.00",
          replay_events: 1
        },
        {
          day: "2026-03-02",
          points_issued: 15,
          points_redeemed: 0,
          points_reversed: 5,
          points_expired: 2,
          adjustment_points: 3,
          gift_cards_issued_q: "0.00",
          gift_cards_redeemed_q: "0.00",
          replay_events: 0
        }
      ],
      rowCount: 2
    };
  }
  if (text.includes("WITH latest_run AS")) {
    return {
      rows: [{
        pending_corrections_count: 1,
        negative_balance_count: 0,
        latest_reconciliation_mismatches: 2,
        latest_reconciliation_completed_at: "2026-03-08T05:00:00.000Z"
      }],
      rowCount: 1
    };
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
    }
  };
}

async function runRoute(routePath, req) {
  const layer = analyticsCertificationRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = makeRes();
  const handlers = layer.route.stack.map((entry) => entry.handle);
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      try {
        const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
        if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
        else if (handler.length < 3) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  return res;
}

describe("analytics certification routes", () => {
  it("returns certification summary and daily rows", async () => {
    const res = await runRoute("/admin/analytics/ledger-certification", {
      method: "GET",
      path: "/admin/analytics/ledger-certification",
      url: "/admin/analytics/ledger-certification?from=2026-03-01&to=2026-03-02",
      originalUrl: "/admin/analytics/ledger-certification?from=2026-03-01&to=2026-03-02",
      tenantId: "biz-1",
      query: { from: "2026-03-01", to: "2026-03-02" },
      staff: { id: "staff-1", role: "OWNER" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.business.name, "Cafe GT");
    assert.equal(res.body.certification_status, "REVIEW_REQUIRED");
    assert.equal(res.body.summary.points_issued, 35);
    assert.equal(res.body.summary.points_redeemed, 10);
    assert.equal(res.body.summary.points_reversed, 5);
    assert.equal(res.body.summary.adjustment_points, 3);
    assert.equal(res.body.summary.gift_cards_issued_q, 25);
    assert.equal(res.body.summary.pending_corrections_count, 1);
    assert.equal(res.body.daily_rows.length, 2);
  });

  it("returns certification csv export", async () => {
    const res = await runRoute("/admin/analytics/ledger-certification.csv", {
      method: "GET",
      path: "/admin/analytics/ledger-certification.csv",
      url: "/admin/analytics/ledger-certification.csv?from=2026-03-01&to=2026-03-02",
      originalUrl: "/admin/analytics/ledger-certification.csv?from=2026-03-01&to=2026-03-02",
      tenantId: "biz-1",
      query: { from: "2026-03-01", to: "2026-03-02" },
      staff: { id: "staff-1", role: "OWNER" }
    });

    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["Content-Type"] || ""), /text\/csv/);
    assert.match(String(res.headers["Content-Disposition"] || ""), /ledger-certification-2026-03-01_to_2026-03-02\.csv/);
    assert.match(String(res.body), /row_type,date,points_issued/);
    assert.match(String(res.body), /TOTAL,,35,10,5,2,3,25.00,5.00,1,REVIEW_REQUIRED,1,2,0/);
    assert.match(String(res.body), /DAY,2026-03-01,20,10,0,0,0,25.00,5.00,1/);
  });

  it("returns archive days and tenant-specific download URLs", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cert-archive-"));
    const previousRoot = process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT;
    process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT = tmpDir;
    try {
      const dayDir = path.join(tmpDir, "2026-03-08");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(dayDir, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(tmpDir, "index.json"), `${JSON.stringify({
        generated_at: "2026-03-08T10:00:00.000Z",
        retention_days: 90,
        day_count: 1,
        days: [{ date: "2026-03-08", business_count: 1, manifest_path: "2026-03-08/index.json", artifact_dir: "2026-03-08" }]
      }, null, 2)}\n`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "index.json"), `${JSON.stringify({
        generated_at: "2026-03-08T10:00:00.000Z",
        date: "2026-03-08",
        business_count: 1,
        artifacts: [{
          businessId: "biz-1",
          businessName: "Cafe GT",
          businessSlug: "cafe-gt",
          certificationStatus: "OK",
          period: { from: "2026-02-07", to: "2026-03-08" },
          generatedAt: "2026-03-08T10:00:00.000Z",
          jsonPath: "2026-03-08/cafe-gt_biz-1.json",
          csvPath: "2026-03-08/cafe-gt_biz-1.csv"
        }]
      }, null, 2)}\n`);

      const res = await runRoute("/admin/analytics/ledger-certification/archive", {
        method: "GET",
        path: "/admin/analytics/ledger-certification/archive",
        url: "/admin/analytics/ledger-certification/archive",
        originalUrl: "/admin/analytics/ledger-certification/archive",
        tenantId: "biz-1",
        query: {},
        staff: { id: "staff-1", role: "OWNER" }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.available_days.length, 1);
      assert.equal(res.body.available_days[0].json_url, "/api/admin/analytics/ledger-certification/archive/2026-03-08");
      assert.equal(res.body.available_days[0].csv_url, "/api/admin/analytics/ledger-certification/archive/2026-03-08.csv");
    } finally {
      if (previousRoot === undefined) delete process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT;
      else process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT = previousRoot;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns stored archive json and csv artifacts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cert-artifact-"));
    const previousRoot = process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT;
    process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT = tmpDir;
    try {
      const dayDir = path.join(tmpDir, "2026-03-08");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(dayDir, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "index.json"), `${JSON.stringify({
        generated_at: "2026-03-08T10:00:00.000Z",
        date: "2026-03-08",
        business_count: 1,
        artifacts: [{
          businessId: "biz-1",
          businessName: "Cafe GT",
          businessSlug: "cafe-gt",
          certificationStatus: "OK",
          period: { from: "2026-02-07", to: "2026-03-08" },
          generatedAt: "2026-03-08T10:00:00.000Z",
          jsonPath: "2026-03-08/cafe-gt_biz-1.json",
          csvPath: "2026-03-08/cafe-gt_biz-1.csv"
        }]
      }, null, 2)}\n`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "cafe-gt_biz-1.json"), "{\n  \"ok\": true\n}\n");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "cafe-gt_biz-1.csv"), "row_type,date\nTOTAL,\n");

      const jsonRes = await runRoute("/admin/analytics/ledger-certification/archive/:date", {
        method: "GET",
        path: "/admin/analytics/ledger-certification/archive/2026-03-08",
        params: { date: "2026-03-08" },
        url: "/admin/analytics/ledger-certification/archive/2026-03-08",
        originalUrl: "/admin/analytics/ledger-certification/archive/2026-03-08",
        tenantId: "biz-1",
        query: {},
        staff: { id: "staff-1", role: "OWNER" }
      });
      const csvRes = await runRoute("/admin/analytics/ledger-certification/archive/:date.csv", {
        method: "GET",
        path: "/admin/analytics/ledger-certification/archive/2026-03-08.csv",
        params: { date: "2026-03-08" },
        url: "/admin/analytics/ledger-certification/archive/2026-03-08.csv",
        originalUrl: "/admin/analytics/ledger-certification/archive/2026-03-08.csv",
        tenantId: "biz-1",
        query: {},
        staff: { id: "staff-1", role: "OWNER" }
      });

      assert.equal(jsonRes.statusCode, 200);
      assert.match(String(jsonRes.headers["Content-Type"] || ""), /application\/json/);
      assert.match(String(jsonRes.headers["Content-Disposition"] || ""), /cafe-gt_biz-1\.json/);
      assert.match(String(jsonRes.body), /"ok": true/);

      assert.equal(csvRes.statusCode, 200);
      assert.match(String(csvRes.headers["Content-Type"] || ""), /text\/csv/);
      assert.match(String(csvRes.headers["Content-Disposition"] || ""), /cafe-gt_biz-1\.csv/);
      assert.match(String(csvRes.body), /row_type,date/);
    } finally {
      if (previousRoot === undefined) delete process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT;
      else process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT = previousRoot;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
