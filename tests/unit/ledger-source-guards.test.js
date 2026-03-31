import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("positive reward flows update lifetime_points alongside current points", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const achievements = fs.readFileSync(new URL("../../src/app/services/gamification/achievements-service.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const challenges = fs.readFileSync(new URL("../../src/app/services/gamification/challenges-service.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const referrals = fs.readFileSync(new URL("../../src/app/services/referral-service.js", import.meta.url), "utf8");

  assert.match(achievements, /lifetime_points = lifetime_points \+ GREATEST\(\$1, 0\)/);
  assert.match(challenges, /lifetime_points = lifetime_points \+ GREATEST\(\$1, 0\)/);
  assert.match(referrals, /lifetime_points = lifetime_points \+ GREATEST\(\$1, 0\)/);
});

test("worker schedules ledger reconciliation and observability exports its metrics", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const worker = fs.readFileSync(new URL("../../src/app/worker.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const observability = fs.readFileSync(new URL("../../src/app/routes/observability-router.js", import.meta.url), "utf8");

  assert.match(worker, /runLedgerReconciliation/);
  assert.match(observability, /puntos_ledger_reconciliation_last_completed_timestamp/);
  assert.match(observability, /puntos_ledger_reconciliation_mismatched_customers_total/);
});
