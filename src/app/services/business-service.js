import crypto from "node:crypto";
import { BusinessRepo } from "../repositories/business-repository.js";
import { BranchRepo } from "../repositories/branch-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { slugify } from "./slug-service.js";
import { config } from "../../config/index.js";
import { planLimits, canUseProgramType } from "../../utils/plan.js";
import { badRequest, conflict } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { setCurrentTenant, withTransaction, withDbClientContext } from "../database.js";
import { hashPassword } from "../../utils/password-hash.js";
import { assertPasswordAllowed } from "../../utils/password-policy.js";
import { errorMessage, isErrorLike } from "../../utils/error-shape.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */

function id() {
  return crypto.randomUUID();
}

/** @type {Record<string, Array<{ name: string, points_cost: number, description: string }>>} */
const DEFAULT_REWARDS_BY_CATEGORY = {
  cafe: [
    { name: "Bebida gratis", points_cost: 100, description: "Café o bebida gratis" },
    { name: "Pastel gratis", points_cost: 150, description: "Porción de pastel" },
    { name: "10% descuento", points_cost: 75, description: "Descuento en tu compra" },
  ],
  salon: [
    { name: "Corte gratis", points_cost: 300, description: "Corte de cabello gratis" },
    { name: "Tratamiento", points_cost: 250, description: "Tratamiento especial" },
    { name: "20% descuento", points_cost: 180, description: "Descuento en tu servicio" },
  ],
  gym: [
    { name: "1 clase gratis", points_cost: 200, description: "Clase gratis" },
    { name: "Smoothie gratis", points_cost: 120, description: "Smoothie gratis" },
    { name: "Inscripción gratis", points_cost: 400, description: "Exoneración de inscripción" },
  ],
};
const DEFAULT_REFERRAL_SETTINGS = {
  enabled: false,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: null,
  reward_on_signup: false,
};

/**
 * @param {{
 *   businessName: string,
 *   email: string,
 *   phone?: string | null,
 *   password: string,
 *   category?: string | null,
 *   program_type?: string,
 *   program_json?: Record<string, unknown>,
 *   slug?: string | null,
 *   plan?: string | undefined
 * }} input
 */
export async function createBusinessWithOwner({
  businessName,
  email,
  phone,
  password,
  category,
  program_type,
  program_json,
  slug: providedSlug,
  plan: providedPlan = undefined,
}) {
  const slugBase = providedSlug || slugify(businessName);
  if (!slugBase) throw badRequest("Nombre de negocio no válido", "VALIDATION_ERROR");
  let slug = slugBase;

  const businessId = id();
  assertPasswordAllowed(password, {
    email,
    businessName,
    phone,
  });
  const password_hash = await hashPassword(password);

  const plan = providedPlan ? String(providedPlan) : (config.DEFAULT_PLAN ?? "EMPRENDEDOR");
  const programType = program_type ?? "SPEND";
  if (!canUseProgramType(plan, programType)) {
    throw badRequest(`El tipo de programa ${programType} no está disponible en el plan ${plan}.`);
  }
  const programJson = program_json ?? {}; // no silent default rule: the owner chooses (preset or manual)

  const branchId = id();
  const ownerId = id();
  const limits = planLimits(plan);
  const seeds = DEFAULT_REWARDS_BY_CATEGORY[String(category ?? "").toLowerCase()] ?? [];
  const toCreate = seeds.slice(0, limits.rewards);

  /** @type {unknown} */
  let lastErr = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    slug = attempt === 0 ? slugBase : `${slugBase}-${attempt}`;
    try {
      const { business } = await withTransaction(async (/** @type {TxClient} */ client) => {
        // Onboarding happens before any tenant context exists, but our INSERT uses
        // `RETURNING *`, which is subject to SELECT RLS on `businesses`.
        // Pre-setting the tenant to the new business id makes the inserted row
        // immediately visible to the transaction (id = current_tenant()).
        await setCurrentTenant(businessId, { local: true });

        const business = await BusinessRepo.create({
          id: businessId,
          name: businessName,
          slug,
          email,
          phone,
          password_hash,
          category,
          plan,
          program_type: programType,
          program_json: programJson,
        });

        const branchCode = `${slug}-main`;
        await BranchRepo.create({
          id: branchId,
          business_id: businessId,
          name: "Principal",
          address: null,
          code: branchCode,
        });

        await StaffRepo.create({
          id: ownerId,
          business_id: businessId,
          branch_id: branchId,
          name: "Owner",
          email,
          phone,
          role: "OWNER",
          password_hash,
        });

        // Seed rewards respecting plan limits (use the existing tx; do NOT nest transactions).
        for (const r of toCreate) {
          await client.query(
            `INSERT INTO rewards (id, business_id, name, description, points_cost, active)
             VALUES ($1,$2,$3,$4,$5,true)`,
            [id(), businessId, r.name, r.description ?? null, Number(r.points_cost)],
          );
        }

        return { business };
      });

      await runIntegrationHooks({ businessId, programType });

      return { business, ownerId, branchId };
    } catch (err) {
      lastErr = err;
      const details = isErrorLike(err) ? err : undefined;
      const code = details?.code;
      const constraint = String(details?.constraint || "");
      const msg = String(details?.message || "");
      const isUnique = code === "23505";
      const isSlugConflict =
        isUnique && (constraint.includes("slug") || msg.toLowerCase().includes("slug"));
      const isEmailConflict =
        isUnique && (constraint.includes("email") || msg.toLowerCase().includes("email"));

      if (isEmailConflict) throw conflict("Este correo ya está registrado");
      if (providedSlug && isSlugConflict)
        throw conflict("Este identificador (slug) ya está en uso");
      if (isSlugConflict) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error("Could not allocate unique business slug");
}

/** @param {{ businessId: string, programType: string }} input */
async function runIntegrationHooks({ businessId, programType }) {
  return withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
    const steps = [
      async () => {
        const { TierService } = await import("./tier-service.js");
        await TierService.createDefaultTiers(businessId, programType);
      },
      async () => {
        const { GamificationService } = await import("./gamification-service.js");
        await GamificationService.createDefaultAchievements(businessId);
      },
      async () => {
        const { AnalyticsRepository } = await import("../repositories/analytics-repository.js");
        await AnalyticsRepository.createDefaultRFMSegments(businessId);
      },
      async () => {
        const { ReferralRepository } = await import("../repositories/referral-repository.js");
        await ReferralRepository.updateSettings(businessId, DEFAULT_REFERRAL_SETTINGS);
      },
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        logger.warn({ err: errorMessage(err) }, "Post-create hook failed");
      }
    }
  });
}
