import crypto from "node:crypto";

import { config } from "../../config/index.js";
import { withTransaction } from "../database.js";
import { AuthSessionRepo } from "../repositories/auth-session-repository.js";

const TEST_MEMORY_SESSIONS = new Map();
const TOUCH_GRACE_MS = 60 * 1000;

function sessionMode() {
  return config.NODE_ENV === "test" ? "memory" : "db";
}

function now() {
  return Date.now();
}

function asIso(value) {
  return new Date(value).toISOString();
}

function randomSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function ttlConfigFor(actorType) {
  const normalized = String(actorType || "").toUpperCase();
  if (normalized === "SUPER") {
    return {
      idleMs: Number(process.env.SUPER_SESSION_IDLE_MS || 10 * 60 * 1000),
      absoluteMs: Number(process.env.SUPER_SESSION_ABSOLUTE_MS || 4 * 60 * 60 * 1000)
    };
  }
  return {
    idleMs: Number(process.env.APP_SESSION_IDLE_MS || 15 * 60 * 1000),
    absoluteMs: Number(process.env.APP_SESSION_ABSOLUTE_MS || 8 * 60 * 60 * 1000)
  };
}

function memoryCreate(record) {
  TEST_MEMORY_SESSIONS.set(record.session_token_hash, { ...record });
  return { ...record };
}

function memoryLookup(tokenHash) {
  const record = TEST_MEMORY_SESSIONS.get(tokenHash);
  return record ? { ...record } : null;
}

function memoryTouch(id, idleExpiresAt) {
  for (const [key, record] of TEST_MEMORY_SESSIONS.entries()) {
    if (record.id !== id) continue;
    const updated = {
      ...record,
      last_seen_at: asIso(now()),
      idle_expires_at: idleExpiresAt
    };
    TEST_MEMORY_SESSIONS.set(key, updated);
    return { ...updated };
  }
  return null;
}

function memoryMarkReauthenticated(id, { mfaVerified = false } = {}) {
  for (const [key, record] of TEST_MEMORY_SESSIONS.entries()) {
    if (record.id !== id) continue;
    const updated = {
      ...record,
      reauth_verified_at: asIso(now()),
      mfa_verified_at: mfaVerified ? asIso(now()) : record.mfa_verified_at ?? null
    };
    TEST_MEMORY_SESSIONS.set(key, updated);
    return { ...updated };
  }
  return null;
}

function memoryInvalidateById(id, reason) {
  for (const [key, record] of TEST_MEMORY_SESSIONS.entries()) {
    if (record.id !== id) continue;
    const updated = {
      ...record,
      invalidated_at: asIso(now()),
      invalidation_reason: reason ?? record.invalidation_reason ?? null
    };
    TEST_MEMORY_SESSIONS.set(key, updated);
    return { ...updated };
  }
  return null;
}

function memoryInvalidateByActor({ actorType, actorId = null, actorEmail = null, reason }) {
  let count = 0;
  for (const [key, record] of TEST_MEMORY_SESSIONS.entries()) {
    if (record.actor_type !== actorType || record.invalidated_at) continue;
    if (actorId && record.actor_id === actorId) {
      TEST_MEMORY_SESSIONS.set(key, {
        ...record,
        invalidated_at: asIso(now()),
        invalidation_reason: reason ?? null
      });
      count += 1;
      continue;
    }
    if (actorEmail && record.actor_email === actorEmail) {
      TEST_MEMORY_SESSIONS.set(key, {
        ...record,
        invalidated_at: asIso(now()),
        invalidation_reason: reason ?? null
      });
      count += 1;
    }
  }
  return count;
}

export async function createBrowserSession({
  actorType,
  actorId = null,
  actorEmail = null,
  businessId = null,
  role = null,
  branchId = null,
  impersonatedBy = null,
  reauthVerified = false,
  mfaVerified = false,
  meta = {}
}) {
  const token = randomSessionToken();
  const tokenHash = hashSessionToken(token);
  const createdAt = now();
  const ttl = ttlConfigFor(actorType);
  const normalizedActorType = String(actorType || "").toUpperCase();
  const normalizedActorEmail = actorEmail ? String(actorEmail).trim().toLowerCase() : null;
  const record = {
    id: crypto.randomUUID(),
    session_token_hash: tokenHash,
    actor_type: normalizedActorType,
    actor_id: actorId ?? null,
    actor_email: normalizedActorEmail,
    business_id: businessId ?? null,
    role: role ?? null,
    branch_id: branchId ?? null,
    impersonated_by: impersonatedBy ?? null,
    reauth_verified_at: reauthVerified ? asIso(createdAt) : null,
    mfa_verified_at: mfaVerified ? asIso(createdAt) : null,
    last_seen_at: asIso(createdAt),
    idle_expires_at: asIso(createdAt + ttl.idleMs),
    absolute_expires_at: asIso(createdAt + ttl.absoluteMs),
    invalidated_at: null,
    invalidation_reason: null,
    meta: meta && typeof meta === "object" ? meta : {}
  };

  if (sessionMode() === "memory") {
    memoryCreate(record);
  } else {
    await withTransaction(async (client) => {
      await AuthSessionRepo.create(record, client.query.bind(client));
    });
  }

  return {
    token,
    session: {
      ...record,
      session_token_hash: undefined
    }
  };
}

export async function getBrowserSession(token) {
  const tokenHash = hashSessionToken(token);
  return sessionMode() === "memory"
    ? memoryLookup(tokenHash)
    : AuthSessionRepo.lookupByTokenHash(tokenHash);
}

export async function touchBrowserSessionIfNeeded(session) {
  if (!session?.id || !session?.idle_expires_at) return session;
  const lastSeenMs = session.last_seen_at ? Date.parse(String(session.last_seen_at)) : 0;
  if (Number.isFinite(lastSeenMs) && (now() - lastSeenMs) < TOUCH_GRACE_MS) {
    return session;
  }
  const idleExpiresAt = asIso(now() + ttlConfigFor(session.actor_type).idleMs);
  if (sessionMode() === "memory") {
    return memoryTouch(session.id, idleExpiresAt);
  }
  await AuthSessionRepo.touchById(session.id, idleExpiresAt);
  return {
    ...session,
    last_seen_at: asIso(now()),
    idle_expires_at: idleExpiresAt
  };
}

export async function invalidateBrowserSessionById(id, reason = null) {
  if (!id) return null;
  return sessionMode() === "memory"
    ? memoryInvalidateById(id, reason)
    : AuthSessionRepo.invalidateById(id, reason);
}

export async function invalidateBrowserSessionsForActor({ actorType, actorId = null, actorEmail = null, reason = null }) {
  return sessionMode() === "memory"
    ? memoryInvalidateByActor({ actorType, actorId, actorEmail, reason })
    : AuthSessionRepo.invalidateByActor({ actorType, actorId, actorEmail, reason });
}

export async function markBrowserSessionReauthenticated({ sessionId, mfaVerified = false }) {
  if (!sessionId) return null;
  return sessionMode() === "memory"
    ? memoryMarkReauthenticated(sessionId, { mfaVerified })
    : AuthSessionRepo.markReauthenticatedById(sessionId, { mfaVerified });
}

export function browserSessionStatus(session) {
  if (!session) return { ok: false, reason: "missing" };
  if (session.invalidated_at) return { ok: false, reason: "invalidated" };
  const current = now();
  const idleExpiresAt = Date.parse(String(session.idle_expires_at || ""));
  const absoluteExpiresAt = Date.parse(String(session.absolute_expires_at || ""));
  if (!Number.isFinite(idleExpiresAt) || !Number.isFinite(absoluteExpiresAt)) {
    return { ok: false, reason: "corrupt" };
  }
  if (current >= absoluteExpiresAt) return { ok: false, reason: "absolute_expired" };
  if (current >= idleExpiresAt) return { ok: false, reason: "idle_expired" };
  return { ok: true, reason: "active" };
}

export function __resetTestSessions() {
  TEST_MEMORY_SESSIONS.clear();
}
