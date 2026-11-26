import test from "node:test";
import assert from "node:assert/strict";
import { logAudit } from "../../src/app/services/account-security/shared.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { runWithDbContext } from "../../src/app/database.js";

// audit_logs.business_id is NOT NULL (src/app/schema.sql). JSDoc already requires the id,
// but JavaScript callers are not type-checked at runtime, and logAudit turns a failed
// insert into a warning. A missing tenant id must therefore fail loudly before any SQL
// runs, so a test (not a production warning) is what catches a wrongly routed platform
// event. Platform-level records belong in security_events (nullable business_id).

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const STAFF = "33333333-3333-4333-8333-333333333333";

/** Fake pinned connection that records every statement instead of running it. */
function recordingClient() {
  /** @type {string[]} */
  const statements = [];
  return {
    statements,
    client: {
      /** @param {string} sql */
      query: async (sql) => {
        statements.push(sql);
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

test("logAudit without a business id rejects and never reaches the repository", async (t) => {
  /** @type {any[]} */
  const writes = [];
  t.mock.method(AuditRepo, "log", async (/** @type {any} */ entry) => {
    writes.push(entry);
  });
  for (const businessId of [undefined, null, ""]) {
    await assert.rejects(
      logAudit(
        /** @type {any} */ ({
          businessId,
          actorType: "SUPER_ADMIN",
          action: "super.security.lockdown",
        }),
      ),
      /business/i,
    );
  }
  assert.deepEqual(writes, []);
});

test("logAudit with a business id still forwards the tenant-scoped entry", async (t) => {
  /** @type {any[]} */
  const writes = [];
  t.mock.method(AuditRepo, "log", async (/** @type {any} */ entry) => {
    writes.push(entry);
  });
  await logAudit({
    businessId: BUSINESS,
    actorType: "STAFF",
    actorId: STAFF,
    action: "staff.reauth",
    meta: { mfa_enabled: true },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].business_id, BUSINESS);
  assert.equal(writes[0].actor_id, STAFF);
  assert.equal(writes[0].action, "staff.reauth");
  assert.match(writes[0].id, /^[0-9a-f-]{36}$/);
});

test("AuditRepo.log refuses a missing business id before any SQL runs", async () => {
  const db = recordingClient();
  await assert.rejects(
    runWithDbContext({ client: db.client }, () =>
      AuditRepo.log(
        /** @type {any} */ ({
          id: "44444444-4444-4444-8444-444444444444",
          business_id: null,
          actor_type: "SUPER_ADMIN",
          action: "super.security.lockdown",
        }),
      ),
    ),
    /business/i,
  );
  assert.deepEqual(db.statements, []);
});

test("AuditRepo.log inserts the tenant row when the business id is present", async () => {
  const db = recordingClient();
  await runWithDbContext({ client: db.client }, () =>
    AuditRepo.log({
      id: "44444444-4444-4444-8444-444444444444",
      business_id: BUSINESS,
      actor_type: "STAFF",
      action: "staff.reauth",
    }),
  );
  assert.equal(db.statements.length, 1);
  assert.match(db.statements[0], /INSERT INTO audit_logs/);
});
