// Serializes gamification awards for one customer. Awards and refunds already
// lock the source transaction before the customer's balance row, so take the
// balance row lock next, before reading any progress or earned state.
export async function lockCustomerGamification(query, customerId) {
  const { rowCount } = await query(
    `SELECT customer_id FROM customer_balances WHERE customer_id = $1 FOR UPDATE`,
    [customerId]
  );
  if (rowCount) return;
  // Without a balance row, still serialize concurrent gamification work.
  await query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext('gamification-customer'))`,
    [String(customerId)]
  );
}
