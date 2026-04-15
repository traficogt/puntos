import crypto from "node:crypto";
import { normalizePhone } from "../../utils/phone.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  const name = toText(value);
  return name ? name.slice(0, 120) : null;
}

function makeId(deps) {
  return deps?.randomUUID?.() ?? crypto.randomUUID();
}

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

  if (phone) {
    const [existingByPhone, existingById] = await Promise.all([
      customerRepo.getByBusinessAndPhone?.(businessId, phone) ?? null,
      customerId ? customerRepo.getByBusinessAndId?.(businessId, customerId) ?? null : null
    ]);

    if (existingByPhone && existingById && existingByPhone.id !== existingById.id) {
      throw conflict("phone and customerId refer to different customers");
    }

    if (existingByPhone) {
      if (name && name !== existingByPhone.name) {
        return customerRepo.updateName(existingByPhone.id, name);
      }
      return existingByPhone;
    }

    if (existingById) {
      throw conflict("phone and customerId refer to different customers");
    }

    return customerRepo.create({
      id: makeId(deps),
      business_id: businessId,
      phone,
      name
    });
  }

  const existing = await customerRepo.getByBusinessAndId?.(businessId, customerId);
  if (!existing) {
    throw notFound("Customer not found for this business");
  }

  if (name && name !== existing.name) {
    return customerRepo.updateName(existing.id, name);
  }

  return existing;
}
