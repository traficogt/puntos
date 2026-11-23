// Pure helpers for the two programs that keep a spendable member wallet:
// CASHBACK (funded by a % of purchases) and GIFT_CARD (funded by staff loads and
// member-to-member gifts). The running balance lives in the shared wallet ledger
// (cashback_accounts / cashback_transactions, see cashback-service.js). No DB.

import { cashbackTerms } from "./cashback-model.js";
import { pct, toMinor, toNumber } from "../../utils/money.js";

export function giftCardTerms(business) {
  if (!business || business.program_type !== "GIFT_CARD") return null;
  const cfg = business.program_json ?? {};
  const bonus_percent = Math.min(100, Math.max(0, Number(cfg.load_bonus_percent) || 0));
  return { bonus_percent };
}

// Bonus Q added to a load of amount_q at the configured bonus percent. Same
// exact centavo arithmetic as the gift-card ledger (gift-card-program-service).
export function loadBonus(bonus_percent, amount_q) {
  const percent = Math.min(100, Math.max(0, Number(bonus_percent) || 0));
  const amt = Number(amount_q);
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  return toNumber(pct(toMinor(amt), percent));
}

// One descriptor for whichever program keeps a member wallet, so the customer
// card and staff terminal can show the balance for either. null for the rest.
export function walletProgram(business) {
  if (!business) return null;
  if (business.program_type === "CASHBACK") {
    const t = cashbackTerms(business, { amount_q: 0 });
    return { kind: "CASHBACK", percent: t ? t.percent : 0 };
  }
  if (business.program_type === "GIFT_CARD") {
    const g = giftCardTerms(business);
    return { kind: "GIFT_CARD", bonus_percent: g ? g.bonus_percent : 0 };
  }
  return null;
}
