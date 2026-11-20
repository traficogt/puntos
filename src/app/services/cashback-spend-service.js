import crypto from "node:crypto";
import { withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { badRequest } from "../../utils/http-error.js";
import { lookupCustomerByQrToken } from "./staff-service.js";
import { spendCashback } from "./cashback-service.js";

// Staff applies a member's cashback credit as a discount. Resolves the customer
// from the scanned QR (same verification the award flow uses), checks the
// business runs CASHBACK, then debits inside a tenant-scoped transaction so RLS
// and the account lock apply. Idempotent on requestId. Audited.
export async function spendCashbackForStaff({ staff, customerQrToken, amount_q, requestId, note = null }) {
  const { customer } = await lookupCustomerByQrToken({ staff, customerQrToken });
  const business = await BusinessRepo.getById(staff.business_id);
  if (!business || business.program_type !== "CASHBACK") {
    throw badRequest("Este negocio no usa un programa de cashback.");
  }
  const result = await withTransaction((client) =>
    spendCashback(client, {
      businessId: staff.business_id,
      customerId: customer.id,
      staffUserId: staff.id,
      amountQ: amount_q,
      requestId,
      meta: { note }
    })
  );
  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: result.replay ? "cashback.spend.replay" : "cashback.spend",
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      { customer_id: customer.id, request_id: requestId ?? null, amount_q, balance_after_q: result.balance_after_q },
      staff
    )
  }).catch(() => {});
  return {
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    spent_q: result.spent_q,
    balance_after_q: result.balance_after_q,
    replay: result.replay ?? false
  };
}
