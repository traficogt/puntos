// Stamp card program (program_type === 'STAMP'): the classic "sello" / punch
// card -- a member earns one stamp per qualifying event (a visit, or a counted
// item) and the business promises a free reward once the card is full.
//
// Endowed progress (Nunes & Dr`eze, 2006): a card can start with a few stamps
// already filled in as a visible gift, so the member needs fewer real purchases
// to finish. A 10-space card that starts with 2 gifted stamps needs 8 real
// purchases -- the same effort as an 8-space empty card, but framed as already
// under way. See PF's article "La ventaja de empezar con dos sellos".
//
// Stamps are stored as the customer's point balance: evaluatePointRules awards
// exactly one point per real purchase, so the whole points + reward + redemption
// engine is reused unchanged and the free item is an ordinary reward whose cost
// is `purchases_required` (= stamps_required - head_start). This pure helper only
// derives the card's display state from that balance; it writes nothing.
/**
 * @param {{ program_type?: string | null, program_json?: Record<string, any> | null } | null | undefined} business
 * @param {{ points?: number | string | null }} [balance] the member's point balance (real purchases)
 */
export function stampCard(business, { points = 0 } = {}) {
  if (!business || business.program_type !== "STAMP") return null;
  const cfg = business.program_json ?? {};
  const stamps_required = Math.max(2, Math.floor(Number(cfg.stamps_required) || 0) || 10);
  // At least one real purchase must remain, so gifted stamps cap at required - 1.
  const head_start = Math.min(
    stamps_required - 1,
    Math.max(0, Math.floor(Number(cfg.head_start) || 0)),
  );
  const reward_label =
    typeof cfg.reward_label === "string" && cfg.reward_label.trim()
      ? cfg.reward_label.trim()
      : "Premio";
  const unit = cfg.stamp_unit === "item" ? "item" : "visit";
  const earned = Math.max(0, Math.floor(Number(points) || 0)); // real purchases
  const purchases_required = stamps_required - head_start; // real purchases to finish = reward cost
  const filled = Math.min(stamps_required, head_start + earned); // slots shown filled (gift + earned)
  const remaining = Math.max(0, purchases_required - earned);
  const complete = earned >= purchases_required;
  return {
    stamps_required,
    head_start,
    reward_label,
    unit,
    earned,
    filled,
    purchases_required,
    remaining,
    complete,
  };
}
