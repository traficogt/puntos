import crypto from "node:crypto";
import { NativeWalletRepo } from "../../repositories/native-wallet-repository.js";
import { CustomerRepo } from "../../repositories/customer-repository.js";
import { badRequest, forbidden, notFound } from "../../../utils/http-error.js";
import { verifyOfflineCaptureGrant } from "../staff-offline-service.js";

const CODE_PREFIX = "PFW1.";
const TRANSACTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SECONDS = 24 * 60 * 60;

/** @typedef {{ repo?: Pick<typeof NativeWalletRepo, "findByMembershipToken">, customerRepo?: Pick<typeof CustomerRepo, "getById">, verifyOfflineGrant?: typeof verifyOfflineCaptureGrant }} MembershipDeps */

/** @param {unknown} value */
export function isNativeWalletCode(value) {
  if (typeof value !== "string" || value.length !== 48 || !/^PFW1\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const token = value.slice(CODE_PREFIX.length);
  // Reject alternate base64 encodings with nonzero trailing padding bits.
  return Buffer.from(token, "base64url").toString("base64url") === token;
}

/**
 * Resolve only an issued membership. Provider readiness does not affect the
 * validity of an existing membership; revocation and tenant scope do.
 * allowRevoked is reserved for acknowledging an already committed transaction.
 * @param {{ token: string, staff: {id: string, business_id: string}, allowRevoked?: boolean }} input
 * @param {MembershipDeps} [dependencies]
 */
export async function resolveNativeWalletMembership(
  { token, staff, allowRevoked = false },
  { repo = NativeWalletRepo, customerRepo = CustomerRepo } = {}
) {
  if (!isNativeWalletCode(token)) throw badRequest("El código de membresía no es válido.");
  const pass = await repo.findByMembershipToken(token.slice(CODE_PREFIX.length));
  if (!pass) throw notFound("La membresía no está disponible.");
  if (pass.business_id !== staff.business_id) throw forbidden("La membresía pertenece a otro negocio.");
  if (pass.revoked_at && !allowRevoked) throw forbidden("La membresía fue revocada.");
  const customer = await customerRepo.getById(pass.customer_id);
  if (!customer || customer.id !== pass.customer_id || customer.business_id !== staff.business_id
    || customer.deleted_at || pass.customer_deleted_at) throw notFound("Customer not found");
  return { bid: pass.business_id, cid: pass.customer_id, passId: pass.id, createdAt: pass.created_at };
}

/**
 * A persistent membership identifies the customer, while txId identifies one
 * purchase. A stable synthetic jti keeps retries compatible with the ledger's
 * existing QR replay protection without consuming the membership permanently.
 * allowRevoked skips purchase authorization ONLY for the caller's receipt path;
 * the caller must require a matching stored fingerprint and never insert a row.
 * @param {{token: string, staff: {id: string, business_id: string}, txId: string, source?: string, grant?: string, capturedAt?: string, allowRevoked?: boolean, now?: Date}} input
 * @param {MembershipDeps} [dependencies]
 */
export async function verifyNativeWalletAward(
  { token, staff, txId, source = "online", grant = null, capturedAt = undefined, allowRevoked = false, now = new Date() },
  { repo = NativeWalletRepo, customerRepo = CustomerRepo, verifyOfflineGrant = verifyOfflineCaptureGrant } = {}
) {
  if (typeof txId !== "string" || txId.length !== 36 || !TRANSACTION_UUID.test(txId)) {
    throw badRequest("La compra con membresía requiere un txId UUID válido.");
  }
  const member = await resolveNativeWalletMembership({ token, staff, allowRevoked }, { repo, customerRepo });
  const created = member.createdAt ? new Date(member.createdAt).getTime() : NaN;
  if (!Number.isFinite(created)) throw forbidden("La fecha de emisión de la membresía no es válida.");
  if (!allowRevoked && source === "offline") {
    const { captured } = await verifyOfflineGrant({ grant, staff, capturedAt, now });
    if (created > captured) throw forbidden("La membresía no existía en la fecha de captura.");
  }
  const jti = `pfw1_${crypto.createHash("sha256")
    .update(JSON.stringify([member.passId, txId.toLowerCase()])).digest("hex")}`;
  return { bid: member.bid, cid: member.cid, passId: member.passId, jti, iat: Math.floor(created / 1000), exp: Math.floor(now.getTime() / 1000) + MAX_SECONDS };
}
