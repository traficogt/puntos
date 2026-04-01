process.env.NODE_ENV = "test";

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  __resetTestSessions,
  browserSessionStatus,
  createBrowserSession,
  getBrowserSession,
  invalidateBrowserSessionById,
  invalidateBrowserSessionsForActor,
  markBrowserSessionReauthenticated,
  touchBrowserSessionIfNeeded
} from "../../src/app/services/auth-session-service.js";

afterEach(() => {
  __resetTestSessions();
});

describe("auth-session-service", () => {
  it("creates opaque sessions and resolves them from the token", async () => {
    const created = await createBrowserSession({
      actorType: "STAFF",
      actorId: "00000000-0000-0000-0000-000000000001",
      businessId: "00000000-0000-0000-0000-000000000002",
      role: "OWNER",
      branchId: "00000000-0000-0000-0000-000000000003",
      impersonatedBy: "super@example.com"
    });

    assert.ok(created.token);
    const session = await getBrowserSession(created.token);
    assert.equal(session?.actor_type, "STAFF");
    assert.equal(session?.actor_id, "00000000-0000-0000-0000-000000000001");
    assert.equal(session?.business_id, "00000000-0000-0000-0000-000000000002");
    assert.equal(session?.role, "OWNER");
    assert.equal(session?.branch_id, "00000000-0000-0000-0000-000000000003");
    assert.equal(session?.impersonated_by, "super@example.com");
    assert.deepEqual(browserSessionStatus(session), { ok: true, reason: "active" });
  });

  it("touches active sessions and invalidates them by id", async () => {
    const created = await createBrowserSession({
      actorType: "CUSTOMER",
      actorId: "00000000-0000-0000-0000-000000000010",
      businessId: "00000000-0000-0000-0000-000000000011"
    });
    const before = await getBrowserSession(created.token);
    const touched = await touchBrowserSessionIfNeeded({
      ...before,
      last_seen_at: new Date(Date.now() - 120_000).toISOString()
    });
    assert.ok(Date.parse(String(touched?.last_seen_at)) >= Date.parse(String(before?.last_seen_at)));

    await invalidateBrowserSessionById(String(before?.id), "logout");
    const after = await getBrowserSession(created.token);
    assert.equal(browserSessionStatus(after).ok, false);
    assert.equal(browserSessionStatus(after).reason, "invalidated");
  });

  it("invalidates all sessions for the same actor", async () => {
    const first = await createBrowserSession({
      actorType: "SUPER",
      actorEmail: "Super@Example.com"
    });
    const second = await createBrowserSession({
      actorType: "SUPER",
      actorEmail: "super@example.com"
    });

    const count = await invalidateBrowserSessionsForActor({
      actorType: "SUPER",
      actorEmail: "super@example.com",
      reason: "password_reset"
    });
    assert.equal(count, 2);
    assert.equal(browserSessionStatus(await getBrowserSession(first.token)).reason, "invalidated");
    assert.equal(browserSessionStatus(await getBrowserSession(second.token)).reason, "invalidated");
  });

  it("marks a session reauthenticated and records MFA verification when requested", async () => {
    const created = await createBrowserSession({
      actorType: "STAFF",
      actorId: "00000000-0000-0000-0000-000000000021",
      businessId: "00000000-0000-0000-0000-000000000022"
    });

    const before = await getBrowserSession(created.token);
    assert.equal(before?.reauth_verified_at ?? null, null);
    assert.equal(before?.mfa_verified_at ?? null, null);

    await markBrowserSessionReauthenticated({
      sessionId: String(before?.id),
      mfaVerified: true
    });

    const after = await getBrowserSession(created.token);
    assert.ok(after?.reauth_verified_at);
    assert.ok(after?.mfa_verified_at);
  });
});
