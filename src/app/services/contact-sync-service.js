import crypto from "node:crypto";
import { normalizePhone } from "../../utils/phone.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";

/**
 * Injected collaborators. Unit tests supply partial CustomerRepo fakes, so the
 * lookups are optional-called; create/updateName are asserted where reached.
 * @typedef {{
 *   randomUUID?: () => string,
 *   CustomerRepo?: Partial<Pick<typeof import("../repositories/customer-repository.js").CustomerRepo, "getByBusinessAndId" | "getByBusinessAndPhone" | "updateName" | "create">> | null,
 * } | null | undefined} ContactSyncDeps
 */
/** @typedef {{ businessId?: unknown, phone?: unknown, customerId?: unknown, name?: unknown } | null | undefined} ContactSyncInput */
/** @typedef {NonNullable<NonNullable<ContactSyncDeps>["CustomerRepo"]>} ContactSyncCustomerRepo */

/** @param {unknown} value */
function toText(value) {
  return String(value ?? "").trim();
}

/** @param {unknown} value */
function normalizeName(value) {
  const name = toText(value);
  return name ? name.slice(0, 120) : null;
}

/** @param {ContactSyncDeps} deps */
function makeId(deps) {
  return deps?.randomUUID?.() ?? crypto.randomUUID();
}

/**
 * @param {ContactSyncDeps} deps
 * @param {ContactSyncInput} input
 */
export async function upsertContactWithDeps(deps, input) {
  const businessId = toText(input?.businessId);
  if (!businessId) throw badRequest("businessId is required");

  const phone = input?.phone ? normalizePhone(input.phone) : "";
  const customerId = toText(input?.customerId);
  const name = normalizeName(input?.name);

  if (!phone && !customerId) {
    throw badRequest("phone or customerId is required");
  }

  const customerRepo = deps?.CustomerRepo;
  if (!customerRepo) throw badRequest("CustomerRepo is required");

  const existingById = customerId
    ? ((await customerRepo.getByBusinessAndId?.(businessId, customerId)) ?? null)
    : null;
  if (customerId && !existingById) {
    throw notFound("Customer not found for this business");
  }

  if (phone) {
    const existingByPhone = (await customerRepo.getByBusinessAndPhone?.(businessId, phone)) ?? null;
    if (existingByPhone && existingById && existingByPhone.id !== existingById.id) {
      throw conflict("phone and customerId refer to different customers");
    }

    if (existingByPhone) {
      if (name && name !== existingByPhone.name) {
        return /** @type {Required<ContactSyncCustomerRepo>["updateName"]} */ (
          customerRepo.updateName
        )(existingByPhone.id, name);
      }
      return existingByPhone;
    }

    if (existingById) {
      throw conflict("phone does not match the supplied customerId");
    }

    return /** @type {Required<ContactSyncCustomerRepo>["create"]} */ (customerRepo.create)({
      id: makeId(deps),
      business_id: businessId,
      phone,
      name,
    });
  }

  if (name && name !== existingById.name) {
    return /** @type {Required<ContactSyncCustomerRepo>["updateName"]} */ (customerRepo.updateName)(
      existingById.id,
      name,
    );
  }

  return existingById;
}
