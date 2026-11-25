import crypto from "node:crypto";
import { withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { badRequest } from "../../utils/http-error.js";
import { lookupCustomerByQrToken } from "./staff-service.js";
import { spendCashback } from "./cashback-service.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */

// Staff applies a member's cashback credit as a discount. Resolves the customer
// from the scanned QR (same verification the award flow uses), checks the
// business runs CASHBACK, then debits inside a tenant-scoped transaction so RLS
// and the account lock apply. Idempotent on requestId. Audited.
/**
 * @param {{
 *   staff: { id: string, business_id: string, [key: string]: unknown },
 *   customerQrToken: string,
 *   amount_q: number,
 *   requestId?: string | null,
 *   note?: string | null,
 * }} input
 */
export async function spendCashbackForStaff({
  staff,
  customerQrToken,
  amount_q,
  requestId,
  note = null,
}) {
  const { customer } = await lookupCustomerByQrToken({ staff, customerQrToken });
  const business = await BusinessRepo.getById(staff.business_id);
  if (!business || !["CASHBACK", "GIFT_CARD"].includes(business.program_type)) {
    throw badRequest("Este negocio no usa un programa con saldo (cashback o tarjeta).");
  }
  const result = await withTransaction((/** @type {TxClient} */ client) =>
    spendCashback(client, {
      businessId: staff.business_id,
      customerId: customer.id,
      staffUserId: staff.id,
      amountQ: amount_q,
      requestId,
      meta: { note },
    }),
  );
  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: `${business.program_type === "GIFT_CARD" ? "giftcard" : "cashback"}.spend${result.replay ? ".replay" : ""}`,
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      {
        customer_id: customer.id,
        request_id: requestId ?? null,
        amount_q,
        balance_after_q: result.balance_after_q,
      },
      staff,
    ),
  }).catch(() => {});
  return {
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    spent_q: result.spent_q,
    balance_after_q: result.balance_after_q,
    replay: result.replay ?? false,
  };
}
