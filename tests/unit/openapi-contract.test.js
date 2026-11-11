import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenApiDoc } from "../../src/scripts/generate-openapi.mjs";

describe("openapi contract", () => {
  it("documents optional transformed inputs, defaults and coerced query constraints", async () => {
    const doc = await buildOpenApiDoc();
    const schemas = doc.components.schemas;
    assert.deepEqual(schemas.VerifyJoinCodeRequest.required, ["phone", "code"]);
    assert.deepEqual(schemas.VerifyJoinCodeRequest.properties.visitToken, {});
    assert.deepEqual(schemas.RewardCreateRequest.required, ["name", "points_cost"]);
    assert.equal(schemas.RewardCreateRequest.properties.active.default, true);
    const cohorts = doc.paths["/api/v1/admin/analytics/cohorts"].get;
    const months = cohorts.parameters.find(parameter => parameter.name === "months");
    assert.equal(months.required, false);
    assert.equal(months.schema.type, "integer");
    assert.equal(months.schema.minimum, 1);
    assert.equal(months.schema.maximum, 60);
  });

  it("resolves every schema reference and retains automatically discovered route metadata", async () => {
    const doc = await buildOpenApiDoc();
    function inspect(value) {
      if (!value || typeof value !== "object") return;
      if (value.$ref) {
        assert.ok(value.$ref.startsWith("#/"));
        const target = value.$ref.slice(2).split("/").reduce((current, key) => current?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], doc);
        assert.ok(target, `Unresolved schema reference: ${value.$ref}`);
      }
      for (const nested of Object.values(value)) inspect(nested);
    }
    inspect(doc);
    assert.ok(doc.paths["/api/v1/mobile/customer"]?.get);
    assert.ok(doc.paths["/api/v1/admin/activation-insights/reward-exposure"]?.get);
  });

  it("captures middleware-derived security metadata for critical routes", async () => {
    const doc = await buildOpenApiDoc();

    const refund = doc.paths["/api/v1/staff/refund"]?.post;
    assert.deepEqual(refund?.security, [{ staffAuth: [] }]);
    assert.equal(refund?.["x-csrf-required"], true);
    assert.equal(refund?.["x-tenant-context"], true);
    assert.deepEqual(refund?.["x-required-permissions"], ["staff.refund"]);

    const cohorts = doc.paths["/api/v1/admin/analytics/cohorts"]?.get;
    assert.deepEqual(cohorts?.security, [{ staffAuth: [] }]);
    assert.equal(cohorts?.["x-tenant-context"], true);
    assert.deepEqual(cohorts?.["x-plan-features"], ["analytics"]);

    const customerRewards = doc.paths["/api/v1/customer/rewards"]?.get;
    assert.deepEqual(customerRewards?.security, [{ customerAuth: [] }]);
    assert.equal(customerRewards?.["x-tenant-context"], true);
    assert.deepEqual(customerRewards?.["x-plan-features"], ["rewards"]);

    const logout = doc.paths["/api/v1/public/customer/logout"]?.post;
    assert.equal(logout?.["x-csrf-required"], true);
    assert.deepEqual(logout?.security, [{ customerAuth: [] }]);

    const publicOrder = doc.paths["/api/v1/public/orders"]?.post;
    assert.equal(
      publicOrder?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderCreateRequest"
    );
    assert.equal(
      publicOrder?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderCreateResponse"
    );
    assert.deepEqual(
      doc.components?.schemas?.OrderCreateRequest?.properties?.status?.enum,
      ["paid", "completed"]
    );
    assert.equal(
      doc.components?.schemas?.OrderCreateRequest?.properties?.identifierType?.type,
      "string"
    );
    assert.equal(
      doc.components?.schemas?.OrderCreateRequest?.properties?.identifierValue?.type,
      "string"
    );

    assert.ok(doc.paths["/api/v1/public/contacts"]?.post);
    assert.ok(doc.paths["/api/v1/public/contact-identifiers"]?.post);
    assert.ok(doc.paths["/api/v1/public/contact-identifiers/resolve"]?.post);
    assert.ok(doc.paths["/api/v1/public/contact-identifiers/unlink"]?.post);

    const publicContacts = doc.paths["/api/v1/public/contacts"]?.post;
    assert.equal(publicContacts?.["x-hmac-required"], true);
    assert.equal(publicContacts?.parameters?.[0]?.name, "x-signature");

    const publicContactLookup = doc.paths["/api/v1/public/contacts/lookup"]?.post;
    assert.equal(publicContactLookup?.["x-hmac-required"], true);
    assert.equal(
      publicContactLookup?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/PublicContactLookupRequest"
    );
    assert.match(String(publicContactLookup?.description || ""), /raw JSON body/i);

    const publicOrderReturn = doc.paths["/api/v1/public/order-returns"]?.post;
    assert.equal(
      publicOrderReturn?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderReturnCreateRequest"
    );
    assert.equal(
      publicOrderReturn?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderReturnCreateResponse"
    );
    assert.equal(publicOrderReturn?.["x-hmac-required"], true);
  });

  it("includes typed response bodies and shared error envelopes for key routes", async () => {
    const doc = await buildOpenApiDoc();

    const award = doc.paths["/api/v1/staff/award"]?.post;
    assert.equal(
      award?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/StaffAwardResponse"
    );
    assert.equal(
      award?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/ErrorResponse"
    );

    const rewardCreate = doc.paths["/api/v1/admin/rewards"]?.post;
    assert.equal(
      rewardCreate?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/RewardDetailResponse"
    );

    const giftLookup = doc.paths["/api/v1/staff/gift-cards/{codeOrToken}"]?.get;
    assert.equal(
      giftLookup?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/GiftCardLookupResponse"
    );

    const certification = doc.paths["/api/v1/admin/analytics/ledger-certification"]?.get;
    assert.equal(
      certification?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/LedgerCertificationResponse"
    );

    const certificationCsv = doc.paths["/api/v1/admin/analytics/ledger-certification.csv"]?.get;
    assert.equal(
      certificationCsv?.responses?.["200"]?.content?.["text/csv"]?.schema?.type,
      "string"
    );

    assert.ok(doc.components?.schemas?.ErrorResponse);
    assert.ok(doc.components?.schemas?.PaymentWebhookResolveResponse);
    assert.ok(doc.components?.schemas?.LedgerCertificationResponse);
  });
});
