import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { badRequest, notFound } from "../../utils/http-error.js";
import { signCustomerToken, signStaffToken } from "../../utils/auth-token.js";
import { InternalMagicLinkRepo } from "../repositories/internal-magic-link-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";

function hashInternalMagicToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function resolveDeps(overrides = {}) {
  return {
    now: overrides.now ?? (() => new Date()),
    randomBytes: overrides.randomBytes ?? crypto.randomBytes,
    randomUUID: overrides.randomUUID ?? crypto.randomUUID,
    repo: overrides.InternalMagicLinkRepo ?? InternalMagicLinkRepo,
    staffRepo: overrides.StaffRepo ?? StaffRepo,
    customerRepo: overrides.CustomerRepo ?? CustomerRepo,
    signStaff: overrides.signStaffToken ?? signStaffToken,
    signCustomer: overrides.signCustomerToken ?? signCustomerToken,
    runtimeConfig: overrides.config ?? config
  };
}

function makeRawToken(randomBytes) {
  const bytes = randomBytes(24);
  if (typeof bytes === "string") return bytes;
  if (bytes && typeof bytes.toString === "function") {
    return bytes.toString("base64url");
  }
  return String(bytes);
}

function normalizeActorType(actorType) {
  return String(actorType || "").trim().toLowerCase();
}

function normalizeTargetRoute(actorType) {
  return actorType === "customer" ? "customer" : "staff";
}

export async function buildInternalMagicLink({ actorType, actor, target, createdBy, origin }, deps = {}) {
  const resolvedDeps = resolveDeps(deps);
  const normalizedActorType = normalizeActorType(actorType);
  if (!["staff", "customer"].includes(normalizedActorType)) {
    throw badRequest("Tipo de actor inválido.");
  }

  if (normalizedActorType === "staff" && target === "admin-dashboard" && String(actor?.role || "").toUpperCase() !== "OWNER") {
    throw badRequest("Este usuario no puede abrir ese destino.");
  }

  const usageMode = normalizedActorType === "customer" ? "reusable_window" : "single_use";
  const rawToken = makeRawToken(resolvedDeps.randomBytes);
  const expiresAt = new Date(resolvedDeps.now().getTime() + 15 * 60 * 1000);
  const id = resolvedDeps.randomUUID();
  const actorId = actor?.id ?? actor?.actor_id ?? null;
  const businessId = actor?.business_id ?? actor?.businessId ?? null;

  await resolvedDeps.repo.create({
    id,
    actor_type: normalizedActorType,
    actor_id: actorId,
    business_id: businessId,
    target,
    usage_mode: usageMode,
    purpose: "internal_test_access",
    token_hash: hashInternalMagicToken(rawToken),
    created_by: createdBy ?? null,
    expires_at: expiresAt
  });

  const baseOrigin = String(origin || resolvedDeps.runtimeConfig.APP_ORIGIN || "").replace(/\/+$/, "");
  return {
    id,
    url: new URL(`/magic/${normalizeTargetRoute(normalizedActorType)}/${rawToken}`, baseOrigin).toString(),
    usageMode,
    expiresAt: expiresAt.toISOString()
  };
}

export async function consumeInternalMagicLink(rawToken, meta = {}, deps = {}) {
  const resolvedDeps = resolveDeps(deps);
  const token = String(rawToken || "").trim();
  if (!token) {
    throw badRequest("Este enlace no es válido.");
  }

  const record = await resolvedDeps.repo.lookupByTokenHash(hashInternalMagicToken(token));
  if (!record) {
    throw badRequest("Este enlace no es válido.");
  }
  if (record.usage_mode === "single_use" && record.used_at) {
    throw badRequest("Este enlace ya fue usado.");
  }

  if (record.actor_type === "staff") {
    const staff = await resolvedDeps.staffRepo.getById(record.actor_id);
    if (!staff) {
      throw notFound("Este usuario ya no existe.");
    }
    if (String(staff.business_id) !== String(record.business_id)) {
      throw badRequest("Este usuario no pertenece a ese negocio.");
    }
    const tokenValue = await resolvedDeps.signStaff({
      sid: staff.id,
      bid: staff.business_id,
      brid: staff.branch_id,
      role: staff.role
    });
    await resolvedDeps.repo.consumeSingleUse(record.id, meta);
    return {
      actorType: "staff",
      cookieName: resolvedDeps.runtimeConfig.STAFF_COOKIE_NAME,
      token: tokenValue,
      redirectTo: record.target === "admin-dashboard" ? "/admin-dashboard" : "/staff"
    };
  }

  if (record.actor_type === "customer") {
    const customer = await resolvedDeps.customerRepo.getById(record.actor_id);
    if (!customer) {
      throw notFound("Este cliente no existe.");
    }
    if (String(customer.business_id) !== String(record.business_id)) {
      throw badRequest("Este cliente no pertenece a ese negocio.");
    }
    const tokenValue = await resolvedDeps.signCustomer({
      cid: customer.id,
      bid: customer.business_id
    });
    await resolvedDeps.repo.touchReusable(record.id, meta);
    return {
      actorType: "customer",
      cookieName: resolvedDeps.runtimeConfig.CUSTOMER_COOKIE_NAME,
      token: tokenValue,
      redirectTo: "/c"
    };
  }

  throw badRequest("Tipo de actor inválido.");
}
