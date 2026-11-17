import test from "node:test";
import assert from "node:assert/strict";
import { RETRY_ATTEMPT_LIMIT, RETRY_QUEUE_LIMIT, REVIEW_LIMIT, nextRetryState, retryDisposition, selectRetryIds } from "../../src/app/services/pos/receipt-retry.js";

const now = new Date("2026-11-16T12:00:00.000Z");
const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString();
const DAY = 24 * 3600 * 1000;

test("classifies every Loyverse and PF sale issue code", () => {
  for (const code of ["refund", "cancelled", "historic_sale", "store_mismatch", "receipt_not_found", "missing_customer"]) assert.equal(retryDisposition(code), "ignore", code);
  for (const code of ["invalid_receipt", "unsupported_receipt", "invalid_amount", "unverified_payment", "invalid_date", "invalid_items", "invalid_refund", "SALE_409"]) assert.equal(retryDisposition(code), "review", code);
  for (const code of ["customer_not_found", "missing_phone", "invalid_phone", "SALE_404", "SALE_400", "SALE_403", "retry_unavailable", "something_new"]) assert.equal(retryDisposition(code), "retry", code);
});

test("selects due receipts most overdue first; manual syncs ignore the backoff", () => {
  const cfg = { pending_receipts: ["later", "legacy", "due", "later"], pending_receipt_meta: { later: { next_retry_at: iso(60_000) }, due: { next_retry_at: iso(-60_000) } } };
  assert.deepEqual(selectRetryIds(cfg, now, { automatic: true }), ["legacy", "due"]);
  assert.deepEqual(selectRetryIds(cfg, now, { automatic: false }), ["legacy", "due", "later"]);
  assert.deepEqual(selectRetryIds({ pending_receipts: Array.from({ length: 40 }, (_, i) => `r${i}`) }, now, { automatic: true }).length, 25);
  assert.deepEqual(selectRetryIds({}, now), []);
});

test("new failures are queued, dropped or sent to review by code", () => {
  const out = nextRetryState({ cfg: {}, now, attemptedIds: ["a", "b", "c", "d"], issues: [
    { saleId: "a", code: "SALE_404" }, { saleId: "b", code: "missing_customer" }, { saleId: "c", code: "invalid_items" }, { saleId: "", code: "invalid_receipt" }
  ] });
  assert.deepEqual(out.pending_receipts, ["a"]);
  assert.deepEqual(out.pending_receipt_meta.a, { code: "SALE_404", attempts: 1, first_seen_at: now.toISOString(), next_retry_at: iso(5 * 60_000) });
  assert.deepEqual(out.review_receipts.map(row => [row.sale_id, row.code, row.reason]), [["c", "invalid_items", "not_retryable"]]);
  assert.equal(out.overflow, 0);
});

test("retried receipts back off exponentially, resolve, or leave after the attempt limit", () => {
  const cfg = { pending_receipts: ["fixed", "again", "spent", "untouched"], pending_receipt_meta: {
    fixed: { code: "SALE_404", attempts: 2, first_seen_at: iso(-DAY), next_retry_at: iso(-1) },
    again: { code: "SALE_404", attempts: 3, first_seen_at: iso(-DAY), next_retry_at: iso(-1) },
    spent: { code: "missing_phone", attempts: RETRY_ATTEMPT_LIMIT - 1, first_seen_at: iso(-DAY), next_retry_at: iso(-1) },
    untouched: { code: "SALE_404", attempts: 1, first_seen_at: iso(-DAY), next_retry_at: iso(DAY) }
  } };
  const out = nextRetryState({ cfg, now, attemptedIds: ["fixed", "again", "spent"], issues: [{ saleId: "again", code: "invalid_phone" }, { saleId: "spent", code: "missing_phone" }] });
  assert.deepEqual(out.pending_receipts, ["again", "untouched"]);
  assert.deepEqual(out.pending_receipt_meta.again, { code: "invalid_phone", attempts: 4, first_seen_at: iso(-DAY), next_retry_at: iso(40 * 60_000) });
  assert.deepEqual(out.pending_receipt_meta.untouched, cfg.pending_receipt_meta.untouched);
  assert.deepEqual(out.review_receipts.map(row => [row.sale_id, row.reason, row.attempts]), [["spent", "retry_limit", RETRY_ATTEMPT_LIMIT]]);
});

test("backoff is capped at twelve hours", () => {
  const cfg = { pending_receipts: ["r"], pending_receipt_meta: { r: { code: "SALE_404", attempts: 15, first_seen_at: iso(-DAY), next_retry_at: iso(-1) } } };
  const out = nextRetryState({ cfg, now, attemptedIds: ["r"], issues: [{ saleId: "r", code: "SALE_404" }] });
  assert.equal(out.pending_receipt_meta.r.next_retry_at, iso(12 * 3600_000));
});

test("receipts older than seven days leave the queue even when not attempted", () => {
  const cfg = { pending_receipts: ["old", "young"], pending_receipt_meta: {
    old: { code: "SALE_404", attempts: 5, first_seen_at: iso(-7 * DAY), next_retry_at: iso(DAY) },
    young: { code: "SALE_404", attempts: 5, first_seen_at: iso(-6 * DAY), next_retry_at: iso(DAY) }
  } };
  const out = nextRetryState({ cfg, now, attemptedIds: [], issues: [] });
  assert.deepEqual(out.pending_receipts, ["young"]);
  assert.deepEqual(out.review_receipts.map(row => [row.sale_id, row.reason]), [["old", "retry_limit"]]);
});

test("IDs queued by earlier releases without metadata start a fresh, bounded budget", () => {
  const out = nextRetryState({ cfg: { pending_receipts: ["legacy-1", "legacy-2", 7, null, "legacy-1"] }, now, attemptedIds: ["legacy-1"], issues: [{ saleId: "legacy-1", code: "SALE_404" }] });
  assert.deepEqual(out.pending_receipts, ["legacy-1", "legacy-2"]);
  assert.equal(out.pending_receipt_meta["legacy-1"].attempts, 1);
  assert.deepEqual(out.pending_receipt_meta["legacy-2"], { code: null, attempts: 0, first_seen_at: now.toISOString(), next_retry_at: now.toISOString() });
});

test("a full queue moves the longest-waiting receipts to review", () => {
  const ids = Array.from({ length: RETRY_QUEUE_LIMIT }, (_, i) => `old-${i}`);
  const meta = Object.fromEntries(ids.map((id, i) => [id, { code: "SALE_404", attempts: 1, first_seen_at: iso(-DAY + i * 1000), next_retry_at: iso(DAY) }]));
  const out = nextRetryState({ cfg: { pending_receipts: ids, pending_receipt_meta: meta }, now, attemptedIds: ["new-1", "new-2"], issues: [{ saleId: "new-1", code: "SALE_404" }, { saleId: "new-2", code: "SALE_404" }] });
  assert.equal(out.overflow, 2);
  assert.equal(out.pending_receipts.length, RETRY_QUEUE_LIMIT);
  assert.ok(out.pending_receipts.includes("new-1") && out.pending_receipts.includes("new-2"));
  assert.deepEqual(out.review_receipts.map(row => [row.sale_id, row.reason]).sort(), [["old-0", "retry_queue_full"], ["old-1", "retry_queue_full"]]);
});

test("the review list is bounded, newest first, and forgets receipts that later succeed", () => {
  const earlier = Array.from({ length: REVIEW_LIMIT }, (_, i) => ({ sale_id: `prior-${i}`, code: "SALE_409", reason: "not_retryable" }));
  const out = nextRetryState({ cfg: { review_receipts: earlier }, now, attemptedIds: ["prior-0", "fresh"], issues: [{ saleId: "fresh", code: "unverified_payment" }] });
  assert.equal(out.review_receipts.length, REVIEW_LIMIT);
  assert.equal(out.review_receipts[0].sale_id, "fresh");
  assert.equal(out.review_receipts.some(row => row.sale_id === "prior-0"), false);
});
