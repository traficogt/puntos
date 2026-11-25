import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { badRequest, notFound } from "../../utils/http-error.js";
import { signCustomerToken, signStaffToken } from "../../utils/auth-token.js";
import { InternalMagicLinkRepo } from "../repositories/internal-magic-link-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";

/** @typedef {Pick<typeof InternalMagicLinkRepo, "create" | "lookupByTokenHash" | "consumeSingleUse" | "touchReusable">} MagicLinkRepo */
/**
 * Overridable collaborators; unit tests inject fakes with only the methods
 * their scenario reaches.
 * @typedef {{
 *   now?: () => Date,
 *   randomBytes?: (size: number) => { toString(encoding?: string): string } | string,
 *   randomUUID?: () => string,
 *   InternalMagicLinkRepo?: Partial<MagicLinkRepo>,
 *   StaffRepo?: Pick<typeof StaffRepo, "getById">,
 *   CustomerRepo?: Pick<typeof CustomerRepo, "getById">,
 *   signStaffToken?: typeof signStaffToken,
 *   signCustomerToken?: typeof signCustomerToken,
 *   config?: Partial<Pick<typeof config, "APP_ORIGIN" | "STAFF_COOKIE_NAME" | "CUSTOMER_COOKIE_NAME">>,
 * }} InternalMagicLinkDeps
 */
/**
 * Staff or customer the link acts as (a row, or a request body).
 * @typedef {{
 *   id?: string | null,
 *   actor_id?: string | null,
 *   business_id?: string | null,
 *   businessId?: string | null,
 *   role?: string | null,
 *   [key: string]: unknown,
 * }} InternalMagicLinkActor
 */

/** @param {string} rawToken */
function hashInternalMagicToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

/** @param {InternalMagicLinkDeps} [overrides] */
function resolveDeps(overrides = {}) {
  return {
    now: overrides.now ?? (() => new Date()),
    randomBytes: overrides.randomBytes ?? crypto.randomBytes,
    randomUUID: overrides.randomUUID ?? crypto.randomUUID,
    // Tests inject only the repository methods their scenario reaches.
    repo: /** @type {MagicLinkRepo} */ (overrides.InternalMagicLinkRepo ?? InternalMagicLinkRepo),
    staffRepo: overrides.StaffRepo ?? StaffRepo,
    customerRepo: overrides.CustomerRepo ?? CustomerRepo,
    signStaff: overrides.signStaffToken ?? signStaffToken,
    signCustomer: overrides.signCustomerToken ?? signCustomerToken,
    runtimeConfig: overrides.config ?? config,
  };
}

/** @param {(size: number) => { toString(encoding?: string): string } | string} randomBytes */
function makeRawToken(randomBytes) {
  const bytes = randomBytes(24);
  if (typeof bytes === "string") return bytes;
  if (bytes && typeof bytes.toString === "function") {
    return bytes.toString("base64url");
  }
  return String(bytes);
}

/** @param {unknown} actorType */
function normalizeActorType(actorType) {
  return String(actorType || "")
    .trim()
    .toLowerCase();
}

/** @param {string} actorType */
function normalizeTargetRoute(actorType) {
  return actorType === "customer" ? "customer" : "staff";
}

/**
 * @param {string} actorType
 * @param {string} target
 * @param {{ role?: string | null } | null} [actor]
 * @returns {asserts target is import("../repositories/internal-magic-link-repository.js").InternalMagicLinkRow["target"]}
 */
function assertValidTargetForActor(actorType, target, actor = null) {
  if (actorType === "customer") {
    if (target !== "customer-wallet") {
      throw badRequest("Este cliente no puede abrir ese destino.");
    }
    return;
  }

  if (!["staff", "admin-dashboard"].includes(String(target || ""))) {
    throw badRequest("Este usuario no puede abrir ese destino.");
  }
  if (target === "admin-dashboard" && String(actor?.role || "").toUpperCase() !== "OWNER") {
    throw badRequest("Este usuario no puede abrir ese destino.");
  }
}

/**
 * @param {string} actorType
 * @param {InternalMagicLinkActor | null | undefined} actor
 * @returns {{ actorId: string, businessId: string }} the identifiers the link is issued for
 */
function assertActorShape(actorType, actor) {
  const actorId = actor?.id ?? actor?.actor_id ?? null;
  const businessId = actor?.business_id ?? actor?.businessId ?? null;
  if (!actorId || !businessId) {
    throw badRequest(
      actorType === "customer" ? "Este cliente no es válido." : "Este usuario no es válido.",
    );
  }
  return { actorId, businessId };
}

/**
 * @param {{
 *   actorType: unknown,
 *   actor: InternalMagicLinkActor | null | undefined,
 *   target: string,
 *   createdBy?: string | null,
 *   origin?: string | null,
 * }} input
 * @param {InternalMagicLinkDeps} [deps]
 */
export async function buildInternalMagicLink(
  { actorType, actor, target, createdBy, origin },
  deps = {},
) {
  const resolvedDeps = resolveDeps(deps);
  const normalizedActorType = normalizeActorType(actorType);
  if (normalizedActorType !== "staff" && normalizedActorType !== "customer") {
    throw badRequest("Tipo de actor inválido.");
  }
  const { actorId, businessId } = assertActorShape(normalizedActorType, actor);
  assertValidTargetForActor(normalizedActorType, target, actor);

  const usageMode = normalizedActorType === "customer" ? "reusable_window" : "single_use";
  const rawToken = makeRawToken(resolvedDeps.randomBytes);
  const expiresAt = new Date(resolvedDeps.now().getTime() + 15 * 60 * 1000);
  const id = resolvedDeps.randomUUID();

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
    expires_at: expiresAt,
  });

  const baseOrigin = String(origin || resolvedDeps.runtimeConfig.APP_ORIGIN || "").replace(
    /\/+$/,
    "",
  );
  return {
    id,
    url: new URL(
      `/api/magic/${normalizeTargetRoute(normalizedActorType)}/${rawToken}`,
      baseOrigin,
    ).toString(),
    usageMode,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * @param {unknown} rawToken
 * @param {Record<string, unknown>} [meta]
 * @param {InternalMagicLinkDeps} [deps]
 */
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
    if (staff.active === false) {
      throw badRequest("Este usuario no está activo.");
    }
    if (String(staff.business_id) !== String(record.business_id)) {
      throw badRequest("Este usuario no pertenece a ese negocio.");
    }
    assertValidTargetForActor("staff", record.target, staff);
    const consumed = await resolvedDeps.repo.consumeSingleUse(record.id, meta);
    if (!consumed) {
      throw badRequest("Este enlace ya fue usado.");
    }
    const tokenValue = await resolvedDeps.signStaff({
      sid: staff.id,
      bid: staff.business_id,
      brid: staff.branch_id,
      role: staff.role,
      imp: record.created_by ?? null,
    });
    return {
      actorType: "staff",
      cookieName: resolvedDeps.runtimeConfig.STAFF_COOKIE_NAME,
      token: tokenValue,
      redirectTo: record.target === "admin-dashboard" ? "/admin-dashboard" : "/staff",
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
    assertValidTargetForActor("customer", record.target, customer);
    const touched = await resolvedDeps.repo.touchReusable(record.id, meta);
    if (!touched) {
      throw badRequest("Este enlace no es válido.");
    }
    const tokenValue = await resolvedDeps.signCustomer({
      cid: customer.id,
      bid: customer.business_id,
    });
    return {
      actorType: "customer",
      cookieName: resolvedDeps.runtimeConfig.CUSTOMER_COOKIE_NAME,
      token: tokenValue,
      redirectTo: "/c",
    };
  }

  throw badRequest("Tipo de actor inválido.");
}
