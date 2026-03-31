import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ledgerCertificationCsv,
  readLedgerCertificationReportWithDeps,
  rebuildLedgerCertificationIndexesWithDeps,
  writeLedgerCertificationArtifactsWithDeps
} from "../../src/app/services/ledger-certification-service.js";

describe("ledger certification service", () => {
  it("builds certification totals and review status from query results", async () => {
    const report = await readLedgerCertificationReportWithDeps({
      dbQuery: async (sql) => {
        const text = String(sql);
        if (text.includes("FROM businesses")) {
          return { rows: [{ id: "biz-1", name: "Cafe GT", slug: "cafe-gt" }], rowCount: 1 };
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
      }
    }, "biz-1", "2026-03-01", "2026-03-02");

    assert.equal(report.business.name, "Cafe GT");
    assert.equal(report.summary.points_issued, 35);
    assert.equal(report.summary.points_reversed, 5);
    assert.equal(report.summary.adjustment_points, 3);
    assert.equal(report.summary.gift_cards_issued_q, 25);
    assert.equal(report.certification_status, "REVIEW_REQUIRED");
    assert.equal(report.daily_rows.length, 2);
  });

  it("writes json and csv artifacts for a business report", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cert-"));
    const mockReport = {
      ok: true,
      business: { id: "biz-2", name: "Cafe Export", slug: "cafe-export" },
      generated_at: "2026-03-08T09:00:00.000Z",
      period: { from: "2026-03-01", to: "2026-03-08" },
      certification_status: "OK",
      summary: {
        points_issued: 10,
        points_redeemed: 5,
        points_reversed: 0,
        points_expired: 0,
        adjustment_points: 0,
        gift_cards_issued_q: 50,
        gift_cards_redeemed_q: 10,
        replay_events: 0,
        pending_corrections_count: 0,
        negative_balance_count: 0,
        latest_reconciliation_mismatches: 0,
        latest_reconciliation_completed_at: "2026-03-08T08:00:00.000Z"
      },
      daily_rows: [{
        date: "2026-03-08",
        points_issued: 10,
        points_redeemed: 5,
        points_reversed: 0,
        points_expired: 0,
        adjustment_points: 0,
        gift_cards_issued_q: 50,
        gift_cards_redeemed_q: 10,
        replay_events: 0
      }]
    };

    try {
      const result = await writeLedgerCertificationArtifactsWithDeps({
        readReport: async () => mockReport,
        fsModule: fs,
        businessId: "biz-2",
        from: "2026-03-01",
        to: "2026-03-08",
        outputRoot: tmpDir,
        retentionDays: 30
      });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const jsonBody = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const csvBody = fs.readFileSync(result.csvPath, "utf8");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const dayIndex = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const rootIndex = JSON.parse(fs.readFileSync(result.rootIndexPath, "utf8"));
      assert.equal(jsonBody.business.id, "biz-2");
      assert.match(csvBody, /row_type,date,points_issued/);
      assert.match(csvBody, /TOTAL,,10,5,0,0,0,50.00,10.00,0,OK,0,0,0/);
      assert.equal(dayIndex.business_count, 1);
      assert.equal(dayIndex.artifacts[0].businessId, "biz-2");
      assert.equal(rootIndex.day_count, 1);
      assert.equal(rootIndex.days[0].date, "2026-03-08");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prunes old day directories and rebuilds the root index", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cert-retain-"));
    try {
      const mkReport = (id, name, to) => ({
        ok: true,
        business: { id, name, slug: name.toLowerCase().replaceAll(" ", "-") },
        generated_at: `${to}T09:00:00.000Z`,
        period: { from: "2026-03-01", to },
        certification_status: "OK",
        summary: {
          points_issued: 10,
          points_redeemed: 5,
          points_reversed: 0,
          points_expired: 0,
          adjustment_points: 0,
          gift_cards_issued_q: 50,
          gift_cards_redeemed_q: 10,
          replay_events: 0,
          pending_corrections_count: 0,
          negative_balance_count: 0,
          latest_reconciliation_mismatches: 0,
          latest_reconciliation_completed_at: null
        },
        daily_rows: []
      });

      await writeLedgerCertificationArtifactsWithDeps({
        readReport: async () => mkReport("biz-old", "Cafe Old", "2026-03-06"),
        fsModule: fs,
        businessId: "biz-old",
        from: "2026-03-01",
        to: "2026-03-06",
        outputRoot: tmpDir,
        retentionDays: 2
      });
      await writeLedgerCertificationArtifactsWithDeps({
        readReport: async () => mkReport("biz-mid", "Cafe Mid", "2026-03-07"),
        fsModule: fs,
        businessId: "biz-mid",
        from: "2026-03-01",
        to: "2026-03-07",
        outputRoot: tmpDir,
        retentionDays: 2
      });
      const latest = await writeLedgerCertificationArtifactsWithDeps({
        readReport: async () => mkReport("biz-new", "Cafe New", "2026-03-08"),
        fsModule: fs,
        businessId: "biz-new",
        from: "2026-03-01",
        to: "2026-03-08",
        outputRoot: tmpDir,
        retentionDays: 2
      });

      assert.deepEqual(latest.prunedDays, ["2026-03-06"]);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      assert.equal(fs.existsSync(path.join(tmpDir, "2026-03-06")), false);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      assert.equal(fs.existsSync(path.join(tmpDir, "2026-03-07")), true);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      assert.equal(fs.existsSync(path.join(tmpDir, "2026-03-08")), true);

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const rootIndex = JSON.parse(fs.readFileSync(path.join(tmpDir, "index.json"), "utf8"));
      assert.equal(rootIndex.day_count, 2);
      assert.deepEqual(rootIndex.days.map((day) => day.date), ["2026-03-08", "2026-03-07"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("can rebuild indexes from existing artifacts without rewriting reports", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cert-rebuild-"));
    try {
      const dayDir = path.join(tmpDir, "2026-03-08");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(dayDir, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "cafe_gt_biz-1.json"), `${JSON.stringify({
        business: { id: "biz-1", name: "Cafe GT", slug: "cafe-gt" },
        generated_at: "2026-03-08T10:00:00.000Z",
        period: { from: "2026-03-01", to: "2026-03-08" },
        certification_status: "OK"
      }, null, 2)}\n`, "utf8");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(path.join(dayDir, "cafe_gt_biz-1.csv"), "row_type,date\n", "utf8");

      const result = rebuildLedgerCertificationIndexesWithDeps({
        fsModule: fs,
        outputRoot: tmpDir,
        retentionDays: 14
      });

      assert.deepEqual(result.prunedDays, []);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const rootIndex = JSON.parse(fs.readFileSync(path.join(tmpDir, "index.json"), "utf8"));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const dayIndex = JSON.parse(fs.readFileSync(path.join(dayDir, "index.json"), "utf8"));
      assert.equal(rootIndex.day_count, 1);
      assert.equal(dayIndex.business_count, 1);
      assert.equal(dayIndex.artifacts[0].jsonPath, "2026-03-08/cafe_gt_biz-1.json");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renders certification csv rows", () => {
    const csv = ledgerCertificationCsv({
      business: { id: "biz-3", name: "Cafe", slug: "cafe" },
      generated_at: "2026-03-08T09:00:00.000Z",
      period: { from: "2026-03-01", to: "2026-03-08" },
      certification_status: "OK",
      summary: {
        points_issued: 10,
        points_redeemed: 5,
        points_reversed: 0,
        points_expired: 0,
        adjustment_points: 0,
        gift_cards_issued_q: 50,
        gift_cards_redeemed_q: 10,
        replay_events: 0,
        pending_corrections_count: 0,
        negative_balance_count: 0,
        latest_reconciliation_mismatches: 0,
        latest_reconciliation_completed_at: null
      },
      daily_rows: []
    });
    assert.match(csv, /TOTAL,,10,5,0,0,0,50.00,10.00,0,OK,0,0,0/);
  });
});
