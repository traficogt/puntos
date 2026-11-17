// Recovery queue for Loyverse receipts that could not award points yet.
// State lives in program_json.pos_integration:
// - pending_receipts: sale IDs waiting for a retry (kept as a string array,
//   the shape earlier releases stored and other readers count);
// - pending_receipt_meta: { [saleId]: { code, attempts, first_seen_at, next_retry_at } };
// - review_receipts: the most recent receipts that left the queue unresolved.
// The queue never holds back the forward scan.

export const RETRY_BATCH_SIZE = 25;
export const RETRY_QUEUE_LIMIT = 500;
export const RETRY_ATTEMPT_LIMIT = 20;
export const RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEW_LIMIT = 100;
const FIRST_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Receipts that never earn points: refunds, cancellations, receipts outside
// the connection's period or store, deleted receipts and walk-in sales without
// a customer. A receipt changed later in Loyverse gets a new updated_at and is
// read again by the forward scan, so an ID retry adds nothing.
export const IGNORED_RECEIPT_CODES = new Set([
  "refund", "cancelled", "historic_sale", "store_mismatch", "receipt_not_found", "missing_customer"
]);

// Problems in the receipt itself, or a sale ID already used with other data.
// Retrying the same receipt cannot fix them; the owner reviews them.
export const TERMINAL_RECEIPT_CODES = new Set([
  "invalid_receipt", "unsupported_receipt", "invalid_amount", "unverified_payment",
  "invalid_date", "invalid_items", "invalid_refund", "SALE_409"
]);

// Anything else (a customer without a phone or not yet registered in PF,
// program rules, a failed lookup) can change outside the receipt: retry with
// backoff for a bounded time.
export function retryDisposition(code) {
  if (IGNORED_RECEIPT_CODES.has(code)) return "ignore";
  if (TERMINAL_RECEIPT_CODES.has(code)) return "review";
  return "retry";
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function time(value, fallback) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function backoffMs(attempts) {
  return Math.min(MAX_RETRY_INTERVAL_MS, FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(attempts - 1, 16)));
}

/**
 * IDs to look up again in this sync, most overdue first. Automatic syncs wait
 * for each receipt's backoff; an owner's manual sync retries regardless.
 * @param {any} cfg pos_integration settings
 * @param {Date} now
 * @param {{ automatic?: boolean, limit?: number }} options
 */
export function selectRetryIds(cfg, now, { automatic = false, limit = RETRY_BATCH_SIZE } = {}) {
  const meta = cfg?.pending_receipt_meta ?? {};
  const ids = [...new Set((Array.isArray(cfg?.pending_receipts) ? cfg.pending_receipts : []).filter(validId))];
  const nextAt = (id) => time(meta[id]?.next_retry_at, 0);
  return ids
    .filter((id) => !automatic || nextAt(id) <= now.getTime())
    .map((id, index) => ({ id, index, at: nextAt(id) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, limit)
    .map(({ id }) => id);
}

/**
 * Applies one sync's outcome to the queue.
 * @param {{ cfg: any, now: Date, attemptedIds: string[], issues: Array<{ saleId?: string, code?: string }> }} args
 * @returns {{ pending_receipts: string[], pending_receipt_meta: Record<string, any>, review_receipts: any[], overflow: number }}
 */
export function nextRetryState({ cfg, now, attemptedIds, issues }) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const oldMeta = cfg?.pending_receipt_meta ?? {};
  const attempted = new Set(attemptedIds.filter(validId));
  const failures = new Map();
  for (const issue of issues) if (validId(issue?.saleId) && issue.code) failures.set(issue.saleId, issue.code);

  const pending = new Map();
  const reviewed = [];
  const review = (id, code, reason, entry) => reviewed.push({
    sale_id: id, code: code ?? null, reason, attempts: entry?.attempts ?? 0,
    first_seen_at: entry?.first_seen_at ?? nowIso, moved_at: nowIso
  });
  const fail = (id, code, entry) => {
    const disposition = retryDisposition(code);
    if (disposition === "ignore") return;
    if (disposition === "review") return review(id, code, "not_retryable", entry);
    const attempts = (entry?.attempts ?? 0) + 1;
    const next = { code, attempts, first_seen_at: entry?.first_seen_at ?? nowIso, next_retry_at: new Date(nowMs + backoffMs(attempts)).toISOString() };
    if (attempts >= RETRY_ATTEMPT_LIMIT || nowMs - time(next.first_seen_at, nowMs) >= RETRY_MAX_AGE_MS) return review(id, code, "retry_limit", next);
    pending.set(id, next);
  };

  const previous = new Set();
  for (const id of Array.isArray(cfg?.pending_receipts) ? cfg.pending_receipts : []) {
    if (!validId(id) || previous.has(id)) continue;
    previous.add(id);
    const stored = oldMeta[id];
    // Entries from releases without metadata start their budget now.
    const entry = {
      code: typeof stored?.code === "string" ? stored.code : null,
      attempts: Number.isSafeInteger(stored?.attempts) && stored.attempts > 0 ? stored.attempts : 0,
      first_seen_at: new Date(time(stored?.first_seen_at, nowMs)).toISOString(),
      next_retry_at: new Date(time(stored?.next_retry_at, nowMs)).toISOString()
    };
    if (attempted.has(id)) {
      // Awarded, duplicate or no longer listed as failing: resolved.
      if (failures.has(id)) fail(id, failures.get(id), entry);
    } else if (nowMs - time(entry.first_seen_at, nowMs) >= RETRY_MAX_AGE_MS) {
      review(id, entry.code, "retry_limit", entry);
    } else {
      pending.set(id, entry);
    }
  }
  for (const [id, code] of failures) {
    if (!previous.has(id)) fail(id, code, null);
  }

  // A full queue sends its longest-waiting receipts to review instead of
  // holding back new sales.
  let overflow = 0;
  if (pending.size > RETRY_QUEUE_LIMIT) {
    const oldest = [...pending].sort(([, a], [, b]) => time(a.first_seen_at, 0) - time(b.first_seen_at, 0));
    for (const [id, entry] of oldest.slice(0, pending.size - RETRY_QUEUE_LIMIT)) {
      pending.delete(id);
      review(id, entry.code, "retry_queue_full", entry);
      overflow += 1;
    }
  }

  // Newest first; a receipt that now succeeds or fails anew leaves its old row.
  const seen = new Set(reviewed.map((row) => row.sale_id));
  const earlier = (Array.isArray(cfg?.review_receipts) ? cfg.review_receipts : [])
    .filter((row) => validId(row?.sale_id) && !seen.has(row.sale_id) && !pending.has(row.sale_id)
      && !(attempted.has(row.sale_id) && !failures.has(row.sale_id)));
  return {
    pending_receipts: [...pending.keys()],
    pending_receipt_meta: Object.fromEntries(pending),
    review_receipts: [...reviewed.reverse(), ...earlier].slice(0, REVIEW_LIMIT),
    overflow
  };
}
