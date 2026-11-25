import test from "node:test";
import assert from "node:assert/strict";
import {
  lockdownStaffAccount,
  lockdownSuperAccount,
} from "../../src/app/services/account-security/lockdown.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { SuperAdminAuthRepo } from "../../src/app/repositories/super-admin-auth-repository.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";

// audit_logs.business_id is NOT NULL (src/app/schema.sql). A platform-level audit row with
// business_id null fails at insert time, and logAudit turns the failure into a warning, so
// the super lockdown silently lost its record. Platform events belong in security_events,
// whose business_id is nullable.

/** @param {import("node:test").TestContext} t */
function recorders(t) {
  /** @type {any[]} */
  const audits = [];
  /** @type {any[]} */
  const events = [];
  t.mock.method(AuditRepo, "log", async (/** @type {any} */ entry) => {
    audits.push(entry);
  });
  t.mock.method(SecurityEventRepo, "logPrivileged", async (/** @type {any} */ event) => {
    events.push(event);
  });
  return { audits, events };
}

test("super lockdown never attempts a tenant audit row and keeps its record in security_events", async (t) => {
  const { audits, events } = recorders(t);
  // An empty email makes the notification step skip delivery (no mailer in unit tests).
  t.mock.method(SuperAdminAuthRepo, "getEffective", async () => ({ email: "" }));

  const out = await lockdownSuperAccount({ ip: "203.0.113.9", ua: "UA/1.0" });

  assert.equal(out.ok, true);
  assert.deepEqual(audits, []);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "super_account_lockdown");
  assert.equal(events[0].actor_type, "SUPER_ADMIN");
  assert.equal(events[0].business_id ?? null, null);
  assert.equal(events[0].meta.ua, "UA/1.0");
  assert.equal(events[0].meta.revoked_sessions, out.revokedSessions);
});

test("staff lockdown still writes the tenant-scoped audit row with the staff business id", async (t) => {
  const { audits, events } = recorders(t);
  const staff = {
    id: "33333333-3333-4333-8333-333333333333",
    business_id: "11111111-1111-4111-8111-111111111111",
    email: null,
    active: true,
  };
  t.mock.method(StaffRepo, "getById", async () => staff);

  const out = await lockdownStaffAccount({ staffId: staff.id, ip: "203.0.113.9", ua: "UA/1.0" });

  assert.equal(out.ok, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].business_id, staff.business_id);
  assert.equal(audits[0].actor_id, staff.id);
  assert.equal(audits[0].action, "staff.security.lockdown");
  assert.equal(audits[0].ua, "UA/1.0");
  assert.equal(events.length, 1);
  assert.equal(events[0].business_id, staff.business_id);
});
