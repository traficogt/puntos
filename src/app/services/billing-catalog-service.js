// Published prices and provider price ids: one platform setting (`billing_catalog`)
// edited from the super console, with the code defaults of src/utils/plan.js.
// Design of record: docs/product/2026-11-25-self-serve-trial.md, section 3.4.
import { z } from "zod";
import { PlatformSettingsRepo } from "../repositories/platform-settings-repository.js";
import { resolveBillingCatalog } from "../../utils/plan.js";

const amount = z.number().int().min(1).max(1_000_000);
const amounts = z.object({ EMPRENDEDOR: amount, NEGOCIO: amount, EMPRESA: amount }).strict();
const priceIds = z.partialRecord(
  z.enum(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]),
  z.string().min(1).max(120),
);

/** Super-console submission for PUT /api/super/billing/catalog. */
export const BillingCatalogSchema = z
  .object({
    published_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    usd: amounts,
    // Fixed quetzal list amounts chosen by the owner (not spot FX). Null or absent restores
    // the code list prices (PLAN_PRICING_GTQ: 300 / 630 / 1,030).
    gtq: amounts.nullable().optional(),
    // Published amounts always include IVA (owner decision, 2026-11-26); accepted so a
    // resolved catalog round-trips, never switchable from the console.
    iva_included: z.literal(true).optional(),
    // Dated reference rate, informational only (public API); /precios shows the list price.
    gtq_reference: z
      .object({
        rate: z.number().positive().max(1000),
        as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict()
      .nullable()
      .optional(),
    providers: z
      .object({
        recurrente: z
          .object({
            price_ids: z.object({ GTQ: priceIds.optional(), USD: priceIds.optional() }).strict(),
          })
          .strict()
          .optional(),
        stripe: z
          .object({ price_ids: z.object({ USD: priceIds.optional() }).strict() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** @typedef {z.infer<typeof BillingCatalogSchema>} BillingCatalogInput */

export const BillingCatalogService = {
  async get() {
    return resolveBillingCatalog(await PlatformSettingsRepo.getBillingCatalog());
  },

  /** @param {"stripe"|"recurrente"} provider @param {ReturnType<typeof resolveBillingCatalog>} catalog */
  async saveProviderPrices(provider, catalog) {
    return resolveBillingCatalog(
      await PlatformSettingsRepo.saveBillingProviderPrices(provider, catalog.providers[provider]),
    );
  },

  /** @param {BillingCatalogInput} input validated by BillingCatalogSchema */
  async set(input) {
    const resolved = resolveBillingCatalog(input);
    return resolveBillingCatalog(await PlatformSettingsRepo.setBillingCatalog(resolved));
  },
};
