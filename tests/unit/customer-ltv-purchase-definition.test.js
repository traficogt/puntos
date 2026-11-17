import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { reportingPurchase } from "../../src/app/services/reporting-purchase.js";

const normalize = (sql) => sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
const read = (path) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository files.
  return fs.readFileSync(new URL(`../../src/app/${path}`, import.meta.url), "utf8");
};

test("the customer value trigger uses the canonical recorded-purchase definition", () => {
  const predicate = normalize(reportingPurchase("t"));
  for (const path of ["migrations/2026-11-17-analytics-purchase-stats.sql", "schema-extensions.sql"]) {
    const sql = normalize(read(path));
    const start = sql.indexOf("FUNCTION update_customer_ltv()");
    assert.ok(start >= 0, path);
    const body = sql.slice(start, sql.indexOf("ON CONFLICT (customer_id)", start));
    assert.ok(body.includes(predicate), `${path} must embed reportingPurchase('t')`);
    assert.doesNotMatch(body, /source <> 'reversal'/, path);
    assert.match(sql, /trigger_update_customer_ltv AFTER INSERT OR UPDATE OF status, source, type, amount_q, visits, items, original_transaction_id, reversed_transaction_id ON transactions/, path);
  }
});

test("derived customer state and platform health count recorded purchases only", () => {
  for (const path of ["services/customer-derived-state.js", "services/platform-health-service.js", "repositories/analytics/cohorts-repository.js", "repositories/analytics/rfm-repository.js"]) {
    const source = read(path);
    assert.match(source, /reportingPurchase\(["']t["']\)/, path);
    assert.doesNotMatch(source, /type\s*=\s*'PURCHASE'/, path);
  }
});
