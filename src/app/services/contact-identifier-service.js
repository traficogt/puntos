import { badRequest, conflict, notFound } from "../../utils/http-error.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/** @typedef {typeof import("../repositories/contact-identifier-repository.js").ContactIdentifierRepo} ContactIdentifierRepoType */
/**
 * Injected collaborators: the real repositories, or test fakes implementing
 * the methods a given call reaches. Each method is checked before use.
 * @typedef {{
 *   client?: TxClient | null,
 *   dbClient?: TxClient | null,
 *   CustomerRepo?: Partial<Pick<typeof import("../repositories/customer-repository.js").CustomerRepo, "getByBusinessAndId">> | null,
 *   ContactIdentifierRepo?: ContactIdentifierRepoLike | null,
 * } | null | undefined} ContactIdentifierDeps
 */
/**
 * ContactIdentifierRepo as this service drives it. Method signatures (bivariant
 * parameters) let the real repository, which needs a client, and unit-test
 * fakes, called with the `null` this service passes when no client was
 * injected, both satisfy it.
 * @typedef {{
 *   create?(client: TxClient | null, input: Parameters<ContactIdentifierRepoType["create"]>[1]): ReturnType<ContactIdentifierRepoType["create"]>,
 *   getByBusinessTypeAndValue?(client: TxClient | null, businessId: string, identifierType: string, identifierValue: string): ReturnType<ContactIdentifierRepoType["getByBusinessTypeAndValue"]>,
 *   getAnyByBusinessTypeAndValue?(client: TxClient | null, businessId: string, identifierType: string, identifierValue: string): ReturnType<ContactIdentifierRepoType["getAnyByBusinessTypeAndValue"]>,
 *   listByCustomer?(client: TxClient | null, businessId: string, customerId: string): ReturnType<ContactIdentifierRepoType["listByCustomer"]>,
 *   deactivate?(client: TxClient | null, businessId: string, identifierType: string, identifierValue: string): ReturnType<ContactIdentifierRepoType["deactivate"]>
 * }} ContactIdentifierRepoLike
 */
/**
 * Raw request fields; everything is re-validated as text here.
 * @typedef {{
 *   businessId?: unknown,
 *   customerId?: unknown,
 *   identifierType?: unknown,
 *   identifierValue?: unknown,
 *   label?: string | null,
 *   meta?: Record<string, unknown>,
 * } | null | undefined} ContactIdentifierInput
 */

/** @param {unknown} value */
function toText(value) {
  return String(value ?? "").trim();
}

/** @param {ContactIdentifierDeps} deps */
function getClient(deps) {
  return deps?.client ?? deps?.dbClient ?? null;
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {string} businessId
 * @param {string} customerId
 */
async function requireScopedCustomer(deps, businessId, customerId) {
  const customerRepo = deps?.CustomerRepo;
  if (!customerRepo?.getByBusinessAndId) {
    throw badRequest("CustomerRepo is required");
  }

  const customer = await customerRepo.getByBusinessAndId(businessId, customerId);
  if (!customer) {
    throw notFound("Customer not found for this business");
  }

  return customer;
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {string} businessId
 * @param {string} identifierType
 * @param {string} identifierValue
 */
async function getActiveIdentifier(deps, businessId, identifierType, identifierValue) {
  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.getByBusinessTypeAndValue) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.getByBusinessTypeAndValue(
    getClient(deps),
    businessId,
    identifierType,
    identifierValue,
  );
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {string} businessId
 * @param {string} identifierType
 * @param {string} identifierValue
 */
async function getAnyIdentifier(deps, businessId, identifierType, identifierValue) {
  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.getAnyByBusinessTypeAndValue) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.getAnyByBusinessTypeAndValue(
    getClient(deps),
    businessId,
    identifierType,
    identifierValue,
  );
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {ContactIdentifierInput} input
 */
export async function linkContactIdentifierWithDeps(deps, input) {
  const businessId = toText(input?.businessId);
  const customerId = toText(input?.customerId);
  const identifierType = toText(input?.identifierType);
  const identifierValue = toText(input?.identifierValue);

  if (!businessId) throw badRequest("businessId is required");
  if (!customerId) throw badRequest("customerId is required");
  if (!identifierType) throw badRequest("identifierType is required");
  if (!identifierValue) throw badRequest("identifierValue is required");

  const customer = await requireScopedCustomer(deps, businessId, customerId);
  const activeIdentifier = await getActiveIdentifier(
    deps,
    businessId,
    identifierType,
    identifierValue,
  );

  if (activeIdentifier) {
    if (String(activeIdentifier.customer_id) !== String(customer.id)) {
      throw conflict("identifier is already assigned to another customer");
    }
    return activeIdentifier;
  }

  const existingIdentifier = await getAnyIdentifier(
    deps,
    businessId,
    identifierType,
    identifierValue,
  );
  if (existingIdentifier) {
    if (String(existingIdentifier.customer_id) !== String(customer.id)) {
      throw conflict("identifier is already assigned to another customer");
    }
    throw conflict("identifier is inactive and cannot be relinked");
  }

  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.create) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.create(getClient(deps), {
    business_id: businessId,
    customer_id: customer.id,
    identifier_type: identifierType,
    identifier_value: identifierValue,
    label: input?.label ?? null,
    meta: input?.meta ?? {},
    active: true,
  });
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {ContactIdentifierInput} input
 */
export async function listContactIdentifiersWithDeps(deps, input) {
  const businessId = toText(input?.businessId);
  const customerId = toText(input?.customerId);

  if (!businessId) throw badRequest("businessId is required");
  if (!customerId) throw badRequest("customerId is required");

  const customer = await requireScopedCustomer(deps, businessId, customerId);
  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.listByCustomer) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.listByCustomer(getClient(deps), businessId, customer.id);
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {ContactIdentifierInput} input
 */
export async function unlinkContactIdentifierWithDeps(deps, input) {
  const businessId = toText(input?.businessId);
  const identifierType = toText(input?.identifierType);
  const identifierValue = toText(input?.identifierValue);

  if (!businessId) throw badRequest("businessId is required");
  if (!identifierType) throw badRequest("identifierType is required");
  if (!identifierValue) throw badRequest("identifierValue is required");

  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.deactivate) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  const deactivated = await repo.deactivate(
    getClient(deps),
    businessId,
    identifierType,
    identifierValue,
  );

  if (!deactivated) {
    throw notFound("Contact identifier not found for this business");
  }

  return deactivated;
}

/**
 * @param {ContactIdentifierDeps} deps
 * @param {ContactIdentifierInput} input
 */
export async function resolveContactIdentifierWithDeps(deps, input) {
  const businessId = toText(input?.businessId);
  const identifierType = toText(input?.identifierType);
  const identifierValue = toText(input?.identifierValue);

  if (!businessId) throw badRequest("businessId is required");
  if (!identifierType) throw badRequest("identifierType is required");
  if (!identifierValue) throw badRequest("identifierValue is required");

  const identifier = await getActiveIdentifier(deps, businessId, identifierType, identifierValue);
  if (!identifier?.customer_id) {
    throw notFound("Contact identifier not found for this business");
  }

  const customer = await requireScopedCustomer(deps, businessId, identifier.customer_id);
  return customer;
}
