import test from "node:test";
import assert from "node:assert/strict";
import { orderMigrations } from "../../src/app/db/migration-order.js";

test("fresh database dependencies precede ledger and session consumers without renaming history", () => {
  const files = ["2026-03-08-ledger-balance-adjustments.sql", "2026-03-08-ledger-corrections.sql", "2026-03-08-ledger-reconciliation.sql", "2026-03-19-account-security.sql", "2026-03-19-auth-session-mutations.sql", "2026-03-19-auth-sessions.sql"];
  const ordered = orderMigrations(files);
  assert.ok(ordered.indexOf("2026-03-08-ledger-reconciliation.sql") < ordered.indexOf("2026-03-08-ledger-corrections.sql"));
  assert.ok(ordered.indexOf("2026-03-08-ledger-corrections.sql") < ordered.indexOf("2026-03-08-ledger-balance-adjustments.sql"));
  assert.ok(ordered.indexOf("2026-03-19-auth-sessions.sql") < ordered.indexOf("2026-03-19-auth-session-mutations.sql"));
  assert.deepEqual(new Set(ordered), new Set(files));
  assert.deepEqual(orderMigrations([...files].reverse()), ordered);
});
test("a missing prerequisite fails before executing migrations", () => {
  assert.throws(() => orderMigrations(["2026-03-08-ledger-balance-adjustments.sql"]), /Missing migration dependency/);
});
