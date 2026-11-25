import { normalizePhone } from "../../utils/phone.js";
import { notFound } from "../../utils/http-error.js";

/** @typedef {{ query: typeof import("../database.js").dbQuery }} TxClient */
/**
 * Injected collaborators (real repositories or test fakes); every method is
 * optional-checked before use.
 * @typedef {{
 *   client?: TxClient | null,
 *   dbClient?: TxClient | null,
 *   CustomerRepo?: Partial<Pick<typeof import("../repositories/customer-repository.js").CustomerRepo, "getByBusinessAndId" | "getById" | "getByBusinessAndPhone">> | null,
 *   ContactIdentifierRepo?: Partial<Pick<typeof import("../repositories/contact-identifier-repository.js").ContactIdentifierRepo, "getByBusinessTypeAndValue">> | null,
 * } | null | undefined} CustomerResolutionDeps
 */
/**
 * Raw integration request fields.
 * @typedef {{
 *   businessId?: unknown,
 *   customerId?: unknown,
 *   identifierType?: unknown,
 *   identifierValue?: unknown,
 *   customerPhone?: unknown,
 * } | null | undefined} CustomerResolutionInput
 */

/** @param {unknown} value */
function toStringValue(value) {
  return String(value ?? "").trim();
}

/**
 * @param {CustomerResolutionDeps} deps
 * @param {string} businessId
 * @param {unknown} customerId
 */
async function resolveByCustomerId(deps, businessId, customerId) {
  if (!customerId) return null;

  if (deps?.CustomerRepo?.getByBusinessAndId) {
    return deps.CustomerRepo.getByBusinessAndId(businessId, customerId);
  }

  const customer = await deps?.CustomerRepo?.getById?.(customerId);
  if (customer && String(customer.business_id) === String(businessId)) return customer;
  return null;
}

/**
 * @param {CustomerResolutionDeps} deps
 * @param {string} businessId
 * @param {unknown} identifierType
 * @param {unknown} identifierValue
 */
async function resolveByIdentifier(deps, businessId, identifierType, identifierValue) {
  const type = toStringValue(identifierType);
  const value = toStringValue(identifierValue);
  if (!type || !value) return null;

  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.getByBusinessTypeAndValue) return null;

  // `repo` came from `deps`, so deps is set here; the optional chain only informs the type.
  const identifier = await repo.getByBusinessTypeAndValue(
    deps?.client ?? deps?.dbClient ?? null,
    businessId,
    type,
    value,
  );
  if (!identifier) return null;

  if (identifier.customer_id) {
    return resolveByCustomerId(deps, businessId, identifier.customer_id);
  }

  return null;
}

/**
 * @param {CustomerResolutionDeps} deps
 * @param {string} businessId
 * @param {unknown} customerPhone
 */
async function resolveByPhone(deps, businessId, customerPhone) {
  const normalizedPhone = customerPhone ? normalizePhone(customerPhone) : null;
  if (!normalizedPhone) return null;

  return deps?.CustomerRepo?.getByBusinessAndPhone?.(businessId, normalizedPhone) ?? null;
}

/**
 * @param {CustomerResolutionDeps} deps
 * @param {CustomerResolutionInput} input
 */
export async function resolveCustomerForIntegrationWithDeps(deps, input) {
  const businessId = toStringValue(input?.businessId);
  if (!businessId) throw notFound("Customer not found for this business");

  const byCustomerId = await resolveByCustomerId(deps, businessId, input?.customerId);
  if (byCustomerId) return byCustomerId;

  const byIdentifier = await resolveByIdentifier(
    deps,
    businessId,
    input?.identifierType,
    input?.identifierValue,
  );
  if (byIdentifier) return byIdentifier;

  const byPhone = await resolveByPhone(deps, businessId, input?.customerPhone);
  if (byPhone) return byPhone;

  throw notFound("Customer not found for this business");
}
