/**
 * Recorded purchase activity for read-only reports. Expiring loyalty points
 * does not undo a sale; refunds and reversal links do. Do not use this for
 * awarding, eligibility, marketing selection or current point balances.
 * The alias must be a code-supplied, unqualified SQL identifier.
 */
export function reportingPurchase(alias) {
  if (typeof alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) {
    throw new TypeError('A trusted SQL table alias is required.');
  }
  return `(${alias}.source IN ('online', 'offline', 'external', 'order')
    AND (${alias}.type = 'PURCHASE' OR ${alias}.type IS NULL)
    AND ${alias}.status IN ('POSTED', 'PENDING', 'EXPIRED')
    AND (${alias}.amount_q > 0 OR ${alias}.visits > 0 OR ${alias}.items > 0)
    AND ${alias}.original_transaction_id IS NULL
    AND ${alias}.reversed_transaction_id IS NULL)`;
}
