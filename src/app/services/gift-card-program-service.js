import crypto from "node:crypto";
import { withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { badRequest } from "../../utils/http-error.js";
import { lookupCustomerByQrToken } from "./staff-service.js";
import { loadStoredValue, transferStoredValue } from "./cashback-service.js";
import { giftCardTerms, loadBonus } from "./wallet-model.js";

// Staff tops up a member's gift-card wallet. Resolves the customer from the
// scanned QR (same verification the award flow uses), checks the business runs
// GIFT_CARD, applies the configured load bonus, and credits inside a
// tenant-scoped transaction so RLS and the account lock apply. Idempotent on
// requestId. Audited.
export async function loadGiftCardForStaff({ staff, customerQrToken, amount_q, requestId, note = null }) {
  const { customer } = await lookupCustomerByQrToken({ staff, customerQrToken });
  const business = await BusinessRepo.getById(staff.business_id);
  const terms = giftCardTerms(business);
  if (!terms) throw badRequest("Este negocio no usa un programa de tarjeta de regalo.");
  const bonus_q = loadBonus(terms.bonus_percent, amount_q);
  const result = await withTransaction((client) =>
    loadStoredValue(client, {
      businessId: staff.business_id,
      customerId: customer.id,
      staffUserId: staff.id,
      amountQ: amount_q,
      bonusQ: bonus_q,
      requestId,
      meta: { note, bonus_percent: terms.bonus_percent }
    })
  );
  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: result.replay ? "giftcard.load.replay" : "giftcard.load",
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      { customer_id: customer.id, request_id: requestId ?? null, amount_q, bonus_q, balance_after_q: result.balance_after_q },
      staff
    )
  }).catch(() => {});
  return {
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    loaded_q: result.loaded_q,
    base_q: result.base_q,
    bonus_q: result.bonus_q,
    balance_after_q: result.balance_after_q,
    replay: result.replay ?? false
  };
}

// A logged-in member gifts part of their gift-card balance to another member of
// the same business, found by the recipient's phone. Runs in a tenant-scoped
// transaction; the transfer itself is atomic and idempotent on requestId.
export async function transferGiftCardForCustomer({ auth, recipient_phone, amount_q, requestId, note = null }) {
  const business = await BusinessRepo.getById(auth.business_id);
  const terms = giftCardTerms(business);
  if (!terms) throw badRequest("Este negocio no usa un programa de tarjeta de regalo.");
  const phone = String(recipient_phone || "").trim();
  if (!phone) throw badRequest("Ingresa el teléfono de quien recibe el saldo.");
  const recipient = await CustomerRepo.getByBusinessAndPhone(auth.business_id, phone);
  if (!recipient) throw badRequest("No encontramos un cliente con ese teléfono en este negocio.");
  if (recipient.id === auth.id) throw badRequest("No puedes regalarte saldo a ti mismo.");
  const result = await withTransaction((client) =>
    transferStoredValue(client, {
      businessId: auth.business_id,
      fromCustomerId: auth.id,
      toCustomerId: recipient.id,
      amountQ: amount_q,
      requestId,
      meta: { note }
    })
  );
  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: auth.business_id,
    actor_type: "CUSTOMER",
    actor_id: auth.id,
    action: result.replay ? "giftcard.transfer.replay" : "giftcard.transfer",
    ip: null,
    ua: null,
    meta: { to_customer_id: recipient.id, request_id: requestId ?? null, amount_q, balance_after_q: result.balance_after_q }
  }).catch(() => {});
  return {
    recipient: { id: recipient.id, name: recipient.name },
    transferred_q: result.transferred_q,
    balance_after_q: result.balance_after_q,
    replay: result.replay ?? false
  };
}
