import { badRequest, conflict, notFound } from "../../utils/http-error.js";

function toText(value) {
  return String(value ?? "").trim();
}

function getClient(deps) {
  return deps?.client ?? deps?.dbClient ?? null;
}

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

async function getActiveIdentifier(deps, businessId, identifierType, identifierValue) {
  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.getByBusinessTypeAndValue) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.getByBusinessTypeAndValue(
    getClient(deps),
    businessId,
    identifierType,
    identifierValue
  );
}

async function getAnyIdentifier(deps, businessId, identifierType, identifierValue) {
  const repo = deps?.ContactIdentifierRepo;
  if (!repo?.getAnyByBusinessTypeAndValue) {
    throw badRequest("ContactIdentifierRepo is required");
  }

  return repo.getAnyByBusinessTypeAndValue(
    getClient(deps),
    businessId,
    identifierType,
    identifierValue
  );
}

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
  const activeIdentifier = await getActiveIdentifier(deps, businessId, identifierType, identifierValue);

  if (activeIdentifier) {
    if (String(activeIdentifier.customer_id) !== String(customer.id)) {
      throw conflict("identifier is already assigned to another customer");
    }
    return activeIdentifier;
  }

  const existingIdentifier = await getAnyIdentifier(deps, businessId, identifierType, identifierValue);
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
    active: true
  });
}

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
    identifierValue
  );

  if (!deactivated) {
    throw notFound("Contact identifier not found for this business");
  }

  return deactivated;
}

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
