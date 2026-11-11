export async function recentMarketingContact(client,{businessId,customerId,excludeId,now,days=7}) {
  const result=await client.query(`SELECT max(last_attempt_at) AS last_at FROM (
    SELECT last_attempt_at FROM growth_message_outbox WHERE business_id=$1 AND customer_id=$2 AND id<>$3 AND status IN ('processing','accepted','uncertain')
    UNION ALL
    SELECT last_attempt_at FROM lifecycle_message_outbox WHERE business_id=$1 AND customer_id=$2 AND id<>$3 AND status IN ('processing','accepted','uncertain')
  ) contacts WHERE last_attempt_at>$4::timestamptz-($5::int*interval '1 day')`,[businessId,customerId,excludeId,now,days]);
  return result.rows[0]?.last_at??null;
}
