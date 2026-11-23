// Pure cashback math — no DB access, mirrors discount-model.js / stamp-model.js.
//
// A CASHBACK program earns the member a percentage of each purchase back as
// spendable store credit (in Q). This helper only computes how much a given
// purchase earns and surfaces the configured rate; the running balance lives in
// the cashback ledger (see cashback-service.js) and the migration
// 2026-11-20-cashback-ledger.sql.

import { pct, toMinor, toNumber } from "../../utils/money.js";

export function cashbackTerms(business, { amount_q = 0 } = {}) {
  if (!business || business.program_type !== "CASHBACK") return null;
  const cfg = business.program_json ?? {};
  const percent = Math.min(100, Math.max(0, Number(cfg.cashback_percent) || 0));
  if (!(percent > 0)) return null;
  const amount = Math.max(0, Number(amount_q) || 0);
  // Earn amount * percent / 100 in exact centavo arithmetic, rounded half away
  // from zero to the nearest centavo — the same rounding Postgres applies when
  // the value lands in a NUMERIC(12,2) column. (Math.round(amount * percent)
  // on floats misses by a centavo near .xx5: 33.30 at 15% gave 4.99, not 5.00.)
  const earn_q = toNumber(pct(toMinor(amount), percent));
  return { percent, earn_q };
}
