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
  unlinkContactIdentifierWithDeps
} from "../services/contact-identifier-service.js";

export const PublicContactUpsertSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  customerId: z.guid().optional(),
  phone: z.string().min(6).optional(),
  name: z.string().min(1).max(120).optional()
}).refine((value) => Boolean(value.customerId || value.phone), {
  message: "phone or customerId is required"
});

export const PublicContactLookupRequestSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  customerId: z.guid()
});

export const PublicContactIdentifierLinkSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  customerId: z.guid(),
  identifierType: z.string().min(1).max(120),
  identifierValue: z.string().min(1).max(200),
  label: z.string().min(1).max(120).optional(),
  meta: z.record(z.string(), z.any()).optional()
});

export const PublicContactIdentifierResolveSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  identifierType: z.string().min(1).max(120),
  identifierValue: z.string().min(1).max(200)
});

export const PublicContactIdentifierUnlinkSchema = PublicContactIdentifierResolveSchema;

function normalizeSignature(signature) {
  const raw = String(signature || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("sha256=")) return raw.slice(7).trim();
  return raw;
}

function verifySignature(payload, businessSlug, signature) {
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret || payload == null) return false;
  const expected = crypto.createHmac("sha256", String(secret)).update(String(payload)).digest("hex");
  return timingSafeEqualString(normalizeSignature(signature), expected);
}

function contactDeps(client, overrides = {}) {
  return {
    client,
    CustomerRepo,
    ContactIdentifierRepo,
    ...overrides
  };
}

export function createContactSyncRoutes(deps = {}) {
  const router = Router();
  const businessRepo = deps.BusinessRepo ?? BusinessRepo;
  const customerRepo = deps.CustomerRepo ?? CustomerRepo;
  const contactIdentifierRepo = deps.ContactIdentifierRepo ?? ContactIdentifierRepo;
  const withScopedDb = deps.withDbClientContext ?? withDbClientContext;
  const upsertContact = deps.upsertContactWithDeps ?? upsertContactWithDeps;
  const listIdentifiers = deps.listContactIdentifiersWithDeps ?? listContactIdentifiersWithDeps;
  const linkIdentifier = deps.linkContactIdentifierWithDeps ?? linkContactIdentifierWithDeps;
  const resolveIdentifier = deps.resolveContactIdentifierWithDeps ?? resolveContactIdentifierWithDeps;
  const unlinkIdentifier = deps.unlinkContactIdentifierWithDeps ?? unlinkContactIdentifierWithDeps;

  async function loadBusiness(businessSlug) {
    return businessRepo.getPublicBySlug(businessSlug);
  }

  router.post("/public/contacts", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(PublicContactUpsertSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const business = await loadBusiness(parsed.data.businessSlug);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const payload = await withScopedDb({ tenantId: business.id, platformAdmin: false }, async (client) => {
      const serviceDeps = contactDeps(client, {
        CustomerRepo: customerRepo,
        ContactIdentifierRepo: contactIdentifierRepo,
        randomUUID: deps.randomUUID
      });
      const contact = await upsertContact(serviceDeps, {
        businessId: business.id,
        customerId: parsed.data.customerId,
        phone: parsed.data.phone,
        name: parsed.data.name
      });
      const identifiers = await listIdentifiers(serviceDeps, {
        businessId: business.id,
        customerId: contact.id
      });
      return { contact, identifiers };
    });

    return res.json({ ok: true, ...payload });
  }));

  router.post("/public/contacts/lookup", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(PublicContactLookupRequestSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const business = await loadBusiness(parsed.data.businessSlug);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const payload = await withScopedDb({ tenantId: business.id, platformAdmin: false }, async (client) => {
      const serviceDeps = contactDeps(client, {
        CustomerRepo: customerRepo,
        ContactIdentifierRepo: contactIdentifierRepo
      });
      const contact = await customerRepo.getByBusinessAndId(business.id, parsed.data.customerId);
      if (!contact) return null;
      const identifiers = await listIdentifiers(serviceDeps, {
        businessId: business.id,
        customerId: contact.id
      });
      return { contact, identifiers };
    });

    if (!payload) return res.status(404).json({ error: "Customer not found for this business" });
    return res.json({ ok: true, ...payload });
  }));

  router.post("/public/contact-identifiers", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(PublicContactIdentifierLinkSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const business = await loadBusiness(parsed.data.businessSlug);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const identifier = await withScopedDb({ tenantId: business.id, platformAdmin: false }, async (client) => {
      return linkIdentifier(contactDeps(client, {
        CustomerRepo: customerRepo,
        ContactIdentifierRepo: contactIdentifierRepo
      }), {
        businessId: business.id,
        customerId: parsed.data.customerId,
        identifierType: parsed.data.identifierType,
        identifierValue: parsed.data.identifierValue,
        label: parsed.data.label,
        meta: parsed.data.meta
      });
    });

    return res.json({ ok: true, identifier });
  }));

  router.post("/public/contact-identifiers/resolve", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(PublicContactIdentifierResolveSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const business = await loadBusiness(parsed.data.businessSlug);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const contact = await withScopedDb({ tenantId: business.id, platformAdmin: false }, async (client) => {
      return resolveIdentifier(contactDeps(client, {
        CustomerRepo: customerRepo,
        ContactIdentifierRepo: contactIdentifierRepo
      }), {
        businessId: business.id,
        identifierType: parsed.data.identifierType,
        identifierValue: parsed.data.identifierValue
      });
    });

    return res.json({ ok: true, contact });
  }));

  router.post("/public/contact-identifiers/unlink", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(PublicContactIdentifierUnlinkSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const business = await loadBusiness(parsed.data.businessSlug);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const identifier = await withScopedDb({ tenantId: business.id, platformAdmin: false }, async (client) => {
      return unlinkIdentifier(contactDeps(client, {
        CustomerRepo: customerRepo,
        ContactIdentifierRepo: contactIdentifierRepo
      }), {
        businessId: business.id,
        identifierType: parsed.data.identifierType,
        identifierValue: parsed.data.identifierValue
      });
    });

    return res.json({ ok: true, identifier });
  }));

  return router;
}

export const contactSyncRoutes = createContactSyncRoutes();
