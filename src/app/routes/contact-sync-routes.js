import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { config } from "../../config/index.js";
import { validate } from "../../utils/validation.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { withDbClientContext } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { ContactIdentifierRepo } from "../repositories/contact-identifier-repository.js";
import { upsertContactWithDeps } from "../services/contact-sync-service.js";
import {
  linkContactIdentifierWithDeps,
  listContactIdentifiersWithDeps,
  resolveContactIdentifierWithDeps,
  unlinkContactIdentifierWithDeps,
} from "../services/contact-identifier-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("../repositories/base.js").DbClient} DbClient */

export const PublicContactUpsertSchema = z
  .object({
    businessSlug: z.string().min(2).max(120),
    customerId: z.guid().optional(),
    phone: z.string().min(6).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine((value) => Boolean(value.customerId || value.phone), {
    message: "phone or customerId is required",
  });

export const PublicContactLookupRequestSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  customerId: z.guid(),
});

export const PublicContactIdentifierLinkSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  customerId: z.guid(),
  identifierType: z.string().min(1).max(120),
  identifierValue: z.string().min(1).max(200),
  label: z.string().min(1).max(120).optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const PublicContactIdentifierResolveSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  identifierType: z.string().min(1).max(120),
  identifierValue: z.string().min(1).max(200),
});

export const PublicContactIdentifierUnlinkSchema = PublicContactIdentifierResolveSchema;

/**
 * Tenant-scoped database work: `fn` runs with `app.current_tenant` set to `tenantId`.
 * The client is `Partial` because unit tests run the callback with a bare `{}`.
 * @typedef {<T>(
 *   ctx: { tenantId: string, platformAdmin: boolean },
 *   fn: (client: Partial<DbClient>) => Promise<T>
 * ) => Promise<T>} ScopedDbRunner
 */
/**
 * Dependencies handed to the contact services (`contactDeps`). The route itself
 * only calls `CustomerRepo.getByBusinessAndId`; the services may use more. Unit
 * tests pass `{}` for the identifier repository (services are stubbed too).
 * @typedef {{
 *   client: Partial<DbClient>,
 *   CustomerRepo: Pick<typeof CustomerRepo, "getByBusinessAndId"> & Partial<typeof CustomerRepo>,
 *   ContactIdentifierRepo: Partial<typeof ContactIdentifierRepo>,
 *   randomUUID?: () => string
 * }} ContactServiceDeps
 */
/** @typedef {{ businessId: string, identifierType: string, identifierValue: string }} ContactIdentifierRef */
/**
 * Collaborators of the router. Unit tests inject partial repository fakes and
 * service stubs, so service results are forwarded opaquely.
 * @typedef {{
 *   BusinessRepo: Pick<typeof BusinessRepo, "getPublicBySlug">,
 *   CustomerRepo: ContactServiceDeps["CustomerRepo"],
 *   ContactIdentifierRepo: ContactServiceDeps["ContactIdentifierRepo"],
 *   withDbClientContext: ScopedDbRunner,
 *   randomUUID: () => string,
 *   upsertContactWithDeps: (deps: ContactServiceDeps, input: {
 *     businessId: string,
 *     customerId: string | undefined,
 *     phone: string | undefined,
 *     name: string | undefined
 *   }) => Promise<{ id: string } & Record<string, unknown>>,
 *   listContactIdentifiersWithDeps: (deps: ContactServiceDeps, input: {
 *     businessId: string,
 *     customerId: string
 *   }) => Promise<unknown>,
 *   linkContactIdentifierWithDeps: (deps: ContactServiceDeps, input: ContactIdentifierRef & {
 *     customerId: string,
 *     label: string | undefined,
 *     meta: Record<string, unknown> | undefined
 *   }) => Promise<unknown>,
 *   resolveContactIdentifierWithDeps: (deps: ContactServiceDeps, input: ContactIdentifierRef) => Promise<unknown>,
 *   unlinkContactIdentifierWithDeps: (deps: ContactServiceDeps, input: ContactIdentifierRef) => Promise<unknown>
 * }} ContactSyncDeps
 */

/** @param {string | string[] | undefined} signature */
function normalizeSignature(signature) {
  const raw = String(signature || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("sha256=")) return raw.slice(7).trim();
  return raw;
}

/**
 * @param {string | undefined} payload the raw request body
 * @param {string} businessSlug
 * @param {string} signature
 */
function verifySignature(payload, businessSlug, signature) {
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret || payload == null) return false;
  const expected = crypto
    .createHmac("sha256", String(secret))
    .update(String(payload))
    .digest("hex");
  return timingSafeEqualString(normalizeSignature(signature), expected);
}

/**
 * @param {Partial<DbClient>} client
 * @param {Partial<ContactServiceDeps>} [overrides]
 * @returns {ContactServiceDeps}
 */
function contactDeps(client, overrides = {}) {
  return {
    client,
    CustomerRepo,
    ContactIdentifierRepo,
    ...overrides,
  };
}

/** @param {Partial<ContactSyncDeps>} [deps] */
export function createContactSyncRoutes(deps = {}) {
  const router = Router();
  const businessRepo = deps.BusinessRepo ?? BusinessRepo;
  const customerRepo = deps.CustomerRepo ?? CustomerRepo;
  const contactIdentifierRepo = deps.ContactIdentifierRepo ?? ContactIdentifierRepo;
  /** @type {ScopedDbRunner} */
  const withScopedDb = deps.withDbClientContext ?? withDbClientContext;
  const upsertContact = deps.upsertContactWithDeps ?? upsertContactWithDeps;
  const listIdentifiers = deps.listContactIdentifiersWithDeps ?? listContactIdentifiersWithDeps;
  const linkIdentifier = deps.linkContactIdentifierWithDeps ?? linkContactIdentifierWithDeps;
  const resolveIdentifier =
    deps.resolveContactIdentifierWithDeps ?? resolveContactIdentifierWithDeps;
  const unlinkIdentifier = deps.unlinkContactIdentifierWithDeps ?? unlinkContactIdentifierWithDeps;

  /** @param {string} businessSlug */
  async function loadBusiness(businessSlug) {
    return businessRepo.getPublicBySlug(businessSlug);
  }

  router.post(
    "/public/contacts",
    moderateRateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const parsed = validate(PublicContactUpsertSchema, req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const signature = String(req.headers["x-signature"] || "");
        if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
          return res.status(401).json({ error: "Invalid signature" });
        }

        const business = await loadBusiness(parsed.data.businessSlug);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const payload = await withScopedDb(
          { tenantId: business.id, platformAdmin: false },
          async (client) => {
            const serviceDeps = contactDeps(client, {
              CustomerRepo: customerRepo,
              ContactIdentifierRepo: contactIdentifierRepo,
              randomUUID: deps.randomUUID,
            });
            const contact = await upsertContact(serviceDeps, {
              businessId: business.id,
              customerId: parsed.data.customerId,
              phone: parsed.data.phone,
              name: parsed.data.name,
            });
            const identifiers = await listIdentifiers(serviceDeps, {
              businessId: business.id,
              customerId: contact.id,
            });
            return { contact, identifiers };
          },
        );

        return res.json({ ok: true, ...payload });
      },
    ),
  );

  router.post(
    "/public/contacts/lookup",
    moderateRateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const parsed = validate(PublicContactLookupRequestSchema, req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const signature = String(req.headers["x-signature"] || "");
        if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
          return res.status(401).json({ error: "Invalid signature" });
        }

        const business = await loadBusiness(parsed.data.businessSlug);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const payload = await withScopedDb(
          { tenantId: business.id, platformAdmin: false },
          async (client) => {
            const serviceDeps = contactDeps(client, {
              CustomerRepo: customerRepo,
              ContactIdentifierRepo: contactIdentifierRepo,
            });
            const contact = await customerRepo.getByBusinessAndId(
              business.id,
              parsed.data.customerId,
            );
            if (!contact) return null;
            const identifiers = await listIdentifiers(serviceDeps, {
              businessId: business.id,
              customerId: contact.id,
            });
            return { contact, identifiers };
          },
        );

        if (!payload)
          return res.status(404).json({ error: "Customer not found for this business" });
        return res.json({ ok: true, ...payload });
      },
    ),
  );

  router.post(
    "/public/contact-identifiers",
    moderateRateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const parsed = validate(PublicContactIdentifierLinkSchema, req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const signature = String(req.headers["x-signature"] || "");
        if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
          return res.status(401).json({ error: "Invalid signature" });
        }

        const business = await loadBusiness(parsed.data.businessSlug);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const identifier = await withScopedDb(
          { tenantId: business.id, platformAdmin: false },
          async (client) => {
            return linkIdentifier(
              contactDeps(client, {
                CustomerRepo: customerRepo,
                ContactIdentifierRepo: contactIdentifierRepo,
              }),
              {
                businessId: business.id,
                customerId: parsed.data.customerId,
                identifierType: parsed.data.identifierType,
                identifierValue: parsed.data.identifierValue,
                label: parsed.data.label,
                meta: parsed.data.meta,
              },
            );
          },
        );

        return res.json({ ok: true, identifier });
      },
    ),
  );

  router.post(
    "/public/contact-identifiers/resolve",
    moderateRateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const parsed = validate(PublicContactIdentifierResolveSchema, req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const signature = String(req.headers["x-signature"] || "");
        if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
          return res.status(401).json({ error: "Invalid signature" });
        }

        const business = await loadBusiness(parsed.data.businessSlug);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const contact = await withScopedDb(
          { tenantId: business.id, platformAdmin: false },
          async (client) => {
            return resolveIdentifier(
              contactDeps(client, {
                CustomerRepo: customerRepo,
                ContactIdentifierRepo: contactIdentifierRepo,
              }),
              {
                businessId: business.id,
                identifierType: parsed.data.identifierType,
                identifierValue: parsed.data.identifierValue,
              },
            );
          },
        );

        return res.json({ ok: true, contact });
      },
    ),
  );

  router.post(
    "/public/contact-identifiers/unlink",
    moderateRateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const parsed = validate(PublicContactIdentifierUnlinkSchema, req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const signature = String(req.headers["x-signature"] || "");
        if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
          return res.status(401).json({ error: "Invalid signature" });
        }

        const business = await loadBusiness(parsed.data.businessSlug);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const identifier = await withScopedDb(
          { tenantId: business.id, platformAdmin: false },
          async (client) => {
            return unlinkIdentifier(
              contactDeps(client, {
                CustomerRepo: customerRepo,
                ContactIdentifierRepo: contactIdentifierRepo,
              }),
              {
                businessId: business.id,
                identifierType: parsed.data.identifierType,
                identifierValue: parsed.data.identifierValue,
              },
            );
          },
        );

        return res.json({ ok: true, identifier });
      },
    ),
  );

  return router;
}

export const contactSyncRoutes = createContactSyncRoutes();
