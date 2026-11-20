// Pure cashback math — no DB access, mirrors discount-model.js / stamp-model.js.
//
// A CASHBACK program earns the member a percentage of each purchase back as
// spendable store credit (in Q). This helper only computes how much a given
// purchase earns and surfaces the configured rate; the running balance lives in
// the cashback ledger (see cashback-service.js) and the migration
// 2026-11-20-cashback-ledger.sql.

export function cashbackTerms(business, { amount_q = 0 } = {}) {
  if (!business || business.program_type !== "CASHBACK") return null;
  const cfg = business.program_json ?? {};
  const percent = Math.min(100, Math.max(0, Number(cfg.cashback_percent) || 0));
  if (!(percent > 0)) return null;
  const amount = Math.max(0, Number(amount_q) || 0);
  // Earn amount * percent / 100, rounded to the nearest cent.
  const earn_q = Math.round(amount * percent) / 100;
  return { percent, earn_q };
}
