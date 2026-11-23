/**
 * Cross-tab session epoch and pending-logout bookkeeping.
 *
 * Every privileged surface (staff scanner, owner dashboard, staff login, super
 * console) and the customer wallet keep up to three localStorage facts per scope:
 *
 * - an **epoch**: a random id rewritten whenever a session starts or ends, so
 *   sibling tabs and cached offline authority learn that their session is stale;
 * - a **pending logout** flag (`"1"`): the user asked to leave while the server
 *   could not be reached; the device stays blocked until the revocation succeeds;
 * - an optional **snapshot** key holding cached identity that must never outlive
 *   the session that produced it.
 *
 * The module is side-effect free and reads storage lazily, so it works where
 * storage is unavailable and in unit tests that swap `globalThis.localStorage`.
 */

/** @typedef {"staff" | "super" | "customer"} SessionScope */

/**
 * @typedef {object} SessionScopeKeys
 * @property {string} epoch
 * @property {string} pending Empty when the scope has no pending-logout flag.
 * @property {string} snapshot Empty when the scope caches no identity snapshot.
 */

/** @type {Readonly<Record<SessionScope, Readonly<SessionScopeKeys>>>} */
export const SESSION_SCOPES = Object.freeze({
  staff: Object.freeze({
    epoch: "pf_staff_epoch",
    pending: "pf_staff_logout_pending",
    snapshot: "pf_staff_snapshot",
  }),
  super: Object.freeze({
    epoch: "pf_super_epoch",
    pending: "pf_super_logout_pending",
    snapshot: "",
  }),
  customer: Object.freeze({ epoch: "pf_customer_epoch", pending: "", snapshot: "" }),
});

/** A fresh, unguessable epoch id; falls back when `crypto.randomUUID` is missing. */
export function newEpochId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

/**
 * Reads a localStorage key, returning "" when the key is empty or storage is unavailable.
 * @param {string} key
 */
function readSessionStorage(key) {
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

/**
 * True when the server already considers the session gone, so a pending logout
 * can be marked complete without a successful revocation round-trip.
 * @param {{ status?: number, code?: string } | null | undefined} error
 */
export function isRevokedSessionError(error) {
  return error?.status === 401 || String(error?.code || "").startsWith("AUTH_");
}

/**
 * Posts the logout request; resolves `true` when the server revoked the session
 * and `false` when it was already revoked. Any other failure is rethrown so the
 * caller keeps the device blocked and retries later.
 * @param {(path: string, opts?: RequestInit) => Promise<unknown>} api
 * @param {string} path
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function revokeServerSession(api, path, { signal } = {}) {
  try {
    await api(path, { method: "POST", body: "{}", ...(signal ? { signal } : {}) });
    return true;
  } catch (error) {
    if (!isRevokedSessionError(error)) throw error;
    return false;
  }
}

/**
 * @typedef {object} SessionEpoch
 * @property {Readonly<SessionScopeKeys>} keys
 * @property {() => string} readEpoch Current epoch, "" when unavailable.
 * @property {() => boolean} hasPendingLogout Whether a logout still awaits the server.
 * @property {() => () => boolean} capture Returns a predicate that stays true while the epoch is unchanged.
 * @property {(options?: { pending?: boolean }) => void} invalidate Drops the snapshot, sets (`true`) or clears (`false`) the pending flag, and announces a new epoch.
 * @property {() => void} clearPendingLogout Marks the pending logout as completed.
 * @property {(event: { key: string | null, newValue?: string | null }) => boolean} supersededBy Another tab started or ended a session (new epoch, or pending logout raised).
 * @property {(event: { key: string | null, newValue?: string | null }) => boolean} pendingClearedBy Another tab finished the pending logout.
 * @property {(event: { key: string | null, newValue?: string | null }) => boolean} touchedBy The event concerns one of this scope's epoch or pending keys.
 */

/**
 * @param {SessionScope} scope
 * @returns {SessionEpoch}
 */
export function createSessionEpoch(scope) {
  const keys = SESSION_SCOPES[scope];
  if (!keys) throw new Error(`Unknown session scope: ${scope}`);
  const readEpoch = () => readSessionStorage(keys.epoch);
  return {
    keys,
    readEpoch,
    hasPendingLogout: () => readSessionStorage(keys.pending) === "1",
    capture() {
      const epoch = readEpoch();
      return () => epoch === readEpoch();
    },
    invalidate({ pending } = {}) {
      try {
        if (keys.snapshot) localStorage.removeItem(keys.snapshot);
        if (keys.pending && pending === true) localStorage.setItem(keys.pending, "1");
        else if (keys.pending && pending === false) localStorage.removeItem(keys.pending);
        localStorage.setItem(keys.epoch, newEpochId());
      } catch {
        /* The current tab stays blocked even when storage is unavailable. */
      }
    },
    clearPendingLogout() {
      if (!keys.pending) return;
      try {
        localStorage.removeItem(keys.pending);
      } catch {
        /* Nothing to clear when storage is unavailable. */
      }
    },
    supersededBy: (event) =>
      event.key === keys.epoch ||
      (Boolean(keys.pending) && event.key === keys.pending && event.newValue === "1"),
    pendingClearedBy: (event) =>
      Boolean(keys.pending) && event.key === keys.pending && !event.newValue,
    touchedBy: (event) =>
      event.key === keys.epoch || (Boolean(keys.pending) && event.key === keys.pending),
  };
}
