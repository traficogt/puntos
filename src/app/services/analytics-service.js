import { BusinessRepo } from "../repositories/business-repository.js";
import { TxnRepo } from "../repositories/transaction-repository.js";
import { many, one } from "../repositories/base.js";

export async function businessSummary(businessId, branchId = null) {
  let customers;
  let active;
  let red30;

  if (!branchId) {
    customers = await one(`SELECT COUNT(*)::int AS c FROM customers WHERE business_id=$1 AND deleted_at IS NULL`, [businessId]);
    active = await BusinessRepo.activeCustomerCount(businessId);
    red30 = await one(
      `SELECT COUNT(*)::int AS c FROM redemptions WHERE business_id=$1 AND created_at >= now() - interval '30 days'`,
      [businessId]
    );
  } else {
    customers = await one(
      `SELECT COUNT(DISTINCT c.id)::int AS c
       FROM customers c
       JOIN transactions t ON t.customer_id = c.id
       WHERE c.business_id=$1
         AND c.deleted_at IS NULL
         AND t.branch_id = $2`,
      [businessId, branchId]
    );
    active = await one(
      `SELECT COUNT(DISTINCT c.id)::int AS c
       FROM customers c
       JOIN transactions t ON t.customer_id = c.id
       WHERE c.business_id=$1
         AND c.deleted_at IS NULL
         AND t.branch_id = $2
         AND COALESCE(c.last_visit_at, c.created_at) >= now() - interval '90 days'`,
      [businessId, branchId]
    );
    red30 = await one(
      `SELECT COUNT(*)::int AS c
       FROM redemptions
       WHERE business_id=$1
         AND branch_id=$2
         AND created_at >= now() - interval '30 days'`,
      [businessId, branchId]
    );
  }

  const tx30 = await TxnRepo.summaryByBusiness(businessId, 30, branchId);

  return {
    customers: customers?.c ?? 0,
    activeCustomers: Number(active?.c ?? active ?? 0),
    tx30,
    redemptions30: red30?.c ?? 0
  };
}

export async function churnCandidates(businessId, days = 30, limit = 200) {
  return many(
    `SELECT id, phone, name, COALESCE(last_visit_at, created_at) AS last_seen
     FROM customers
     WHERE business_id=$1 AND deleted_at IS NULL
       AND COALESCE(last_visit_at, created_at) < now() - ($2 || ' days')::interval
     ORDER BY last_seen ASC
     LIMIT $3`,
    [businessId, String(days), limit]
  );
}
