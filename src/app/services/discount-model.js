// Member discount program (program_type === 'DISCOUNT'): every member gets a
// fixed percentage off each qualifying purchase. Unlike the points programs
// (SPEND / VISIT / ITEM) a discount program accrues no points -- evaluatePointRules
// returns zero for it -- so the benefit is applied at the counter as a discount.
// This pure helper computes that benefit for a given purchase amount, in exact
// centavo arithmetic (see utils/money.js) so 4.10 at 15% off is 0.62, not the
// 0.61 that Math.round(amount * percent) / 100 produces on binary floats.
import { pct, toMinor, toNumber } from "../../utils/money.js";

/** @param {{program_type?: string, program_json?: Record<string, unknown>}|null} business */
export function memberDiscount(business, { amount_q = 0 } = {}) {
  if (!business || business.program_type !== "DISCOUNT") return null;
  const cfg = business.program_json ?? {};
  const percent_off = Math.min(100, Math.max(0, Number(cfg.percent_off) || 0));
  const min_purchase_q = Math.max(0, Number(cfg.min_purchase_q) || 0);
  const amount = Math.max(0, Number(amount_q) || 0);
  const eligible = percent_off > 0 && amount > 0 && amount >= min_purchase_q;
  const discount_q = eligible ? toNumber(pct(toMinor(amount), percent_off)) : 0;
  return { percent_off, min_purchase_q, amount_q: amount, eligible, discount_q };
}
