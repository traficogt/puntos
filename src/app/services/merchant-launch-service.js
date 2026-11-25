import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dbQuery, withTransaction } from "../database.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature, canUseProgramType } from "../../utils/plan.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/** @typedef {import("./merchant-data-readiness.js").MerchantProgramJson} MerchantProgramJson */
/** @type {Record<string, "points_per_q" | "points_per_visit" | "points_per_item">} */
const rateKey = { SPEND: "points_per_q", VISIT: "points_per_visit", ITEM: "points_per_item" };
export const LaunchProgramInput = z
  .object({
    program_type: z.enum(["SPEND", "VISIT", "ITEM", "DISCOUNT", "STAMP", "CASHBACK", "GIFT_CARD"]),
    rate: z.number().finite().positive().max(10000).optional(),
    round: z.enum(["ceil", "round", "floor"]).optional(),
    percent_off: z.number().finite().positive().max(100).optional(),
    stamps_required: z.number().int().positive().max(100).optional(),
    reward_label: z.string().max(60).optional(),
    stamp_unit: z.enum(["visit", "item"]).optional(),
    head_start: z.number().int().nonnegative().max(99).optional(),
    cashback_percent: z.number().finite().positive().max(100).optional(),
    load_bonus_percent: z.number().finite().nonnegative().max(100).optional(),
    version: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.program_type === "DISCOUNT") {
      if (v.percent_off == null)
        ctx.addIssue({
          code: "custom",
          path: ["percent_off"],
          message: "Ingresa el porcentaje de descuento (1 a 100).",
        });
      return;
    }
    if (v.program_type === "CASHBACK") {
      if (v.cashback_percent == null)
        ctx.addIssue({
          code: "custom",
          path: ["cashback_percent"],
          message: "Ingresa el porcentaje de cashback (1 a 100).",
        });
      return;
    }
    if (v.program_type === "GIFT_CARD") {
      return;
    }
    if (v.program_type === "STAMP") {
      if (v.stamps_required == null)
        ctx.addIssue({
          code: "custom",
          path: ["stamps_required"],
          message: "Indica cuantos sellos completan el premio (2 a 100).",
        });
      else if (v.stamps_required < 2)
        ctx.addIssue({
          code: "custom",
          path: ["stamps_required"],
          message: "El premio debe requerir al menos 2 sellos.",
        });
      if (!v.reward_label || !v.reward_label.trim())
        ctx.addIssue({
          code: "custom",
          path: ["reward_label"],
          message: "Escribe el premio (por ejemplo, Cafe gratis).",
        });
      if (v.head_start != null && v.stamps_required != null && v.head_start >= v.stamps_required)
        ctx.addIssue({
          code: "custom",
          path: ["head_start"],
          message: "Los sellos de regalo deben ser menos que el total.",
        });
      return;
    }
    if (v.rate == null) {
      ctx.addIssue({ code: "custom", path: ["rate"], message: "Ingresa la regla de puntos." });
      return;
    }
    const ok =
      v.program_type === "SPEND"
        ? Math.abs(v.rate * 10000 - Math.round(v.rate * 10000)) < 0.000001
        : Number.isInteger(v.rate);
    if (!ok)
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "Usa hasta cuatro decimales por quetzal y puntos enteros por visita o artículo.",
      });
  });
/** @param {{ program_type?: string | null, program_json?: MerchantProgramJson | null }} business */
export function programBasics(business) {
  /** @type {MerchantProgramJson} */
  const config = business.program_json ?? {};
  const type = business.program_type ?? "SPEND";
  const basics = {
    program_type: type,
    points_per_q: config.points_per_q ?? null,
    points_per_visit: config.points_per_visit ?? null,
    points_per_item: config.points_per_item ?? null,
    round: config.round ?? "ceil",
    percent_off: config.percent_off ?? null,
    stamps_required: config.stamps_required ?? null,
    reward_label: config.reward_label ?? null,
    stamp_unit: config.stamp_unit ?? "visit",
    head_start: config.head_start ?? null,
    cashback_percent: config.cashback_percent ?? null,
    load_bonus_percent: config.load_bonus_percent ?? null,
  };
  const version = createHash("sha256").update(JSON.stringify(basics)).digest("hex");
  const raw = basics[rateKey[type]],
    rate = raw == null ? null : Number(raw);
  return {
    program_type: type,
    rate: Number.isFinite(rate) ? rate : null,
    round: basics.round,
    percent_off: basics.percent_off,
    stamps_required: basics.stamps_required,
    reward_label: basics.reward_label,
    stamp_unit: basics.stamp_unit,
    head_start: basics.head_start,
    cashback_percent: basics.cashback_percent,
    load_bonus_percent: basics.load_bonus_percent,
    version,
  };
}
/**
 * @param {{ businessId: string }} target
 * @param {typeof dbQuery} [query]
 */
export async function getLaunchProgram({ businessId }, query = dbQuery) {
  const { rows } = await query("SELECT program_type,program_json FROM businesses WHERE id=$1", [
    businessId,
  ]);
  if (!rows[0]) throw notFound("Negocio no encontrado.");
  return { ok: true, program: programBasics(rows[0]) };
}
/**
 * @param {TxClient} client
 * @param {{
 *   businessId: string,
 *   programType: string,
 *   patch: { stamps_required?: number, head_start?: number, reward_label?: string, [key: string]: unknown },
 *   priorRewardId: string | null,
 * }} input
 */
async function ensureStampReward(client, { businessId, programType, patch, priorRewardId }) {
  if (programType === "STAMP") {
    // The free item is an ordinary reward whose cost is the real purchases needed
    // (stamps_required - head_start). Stamps are points, so resizing the card only
    // updates this cost; members keep their progress. Idempotent via stamp_reward_id.
    // A STAMP patch always carries both counts (see updateLaunchProgram).
    const cost = Number(patch.stamps_required) - Number(patch.head_start),
      name = patch.reward_label,
      desc = "Premio de tu tarjeta de sellos";
    let rewardId = priorRewardId;
    if (rewardId) {
      const upd = await client.query(
        "UPDATE rewards SET name=$3,description=$4,points_cost=$5,active=true,stock=NULL,valid_until=NULL WHERE id=$1 AND business_id=$2 RETURNING id",
        [rewardId, businessId, name, desc, cost],
      );
      if (!upd.rows[0]) rewardId = null;
    }
    if (!rewardId) {
      rewardId = randomUUID();
      await client.query(
        "INSERT INTO rewards (id, business_id, name, description, points_cost, active) VALUES ($1,$2,$3,$4,$5,true)",
        [rewardId, businessId, name, desc, cost],
      );
    }
    await client.query(
      "UPDATE businesses SET program_json=COALESCE(program_json,'{}'::jsonb)||$2::jsonb WHERE id=$1",
      [businessId, JSON.stringify({ stamp_reward_id: rewardId })],
    );
  } else if (priorRewardId) {
    // Switched away from a stamp card: retire its auto reward so it is not a stray redeemable.
    await client.query("UPDATE rewards SET active=false WHERE id=$1 AND business_id=$2", [
      priorRewardId,
      businessId,
    ]);
  }
}
/**
 * @param {{
 *   businessId: string,
 *   staffId?: string | null,
 *   input: unknown,
 *   ip?: string | null,
 *   ua?: string | null,
 *   impersonated_by?: string | null,
 * }} options
 * @param {{
 *   transaction?: typeof withTransaction,
 *   getPlanFeatureOverrides?: () => ReturnType<typeof PlanConfigService.getPlanFeatureOverrides>,
 * }} [injected]
 */
export async function updateLaunchProgram(options, injected = {}) {
  const parsed = LaunchProgramInput.safeParse(options.input);
  if (!parsed.success) throw badRequest("Revisa la regla de puntos.");
  const d = {
    transaction: withTransaction,
    getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides(),
    ...injected,
  };
  const overrides = await d.getPlanFeatureOverrides(),
    input = parsed.data;
  return d.transaction(async (/** @type {TxClient} */ client) => {
    const { rows } = await client.query(
      "SELECT id,plan,program_type,program_json FROM businesses WHERE id=$1 FOR NO KEY UPDATE",
      [options.businessId],
    );
    const business = rows[0];
    if (!business) throw notFound("Negocio no encontrado.");
    if (!hasPlanFeature(business.plan, "program_rules", overrides))
      throw forbidden("Tu plan no permite editar el programa.");
    if (!canUseProgramType(business.plan, input.program_type, overrides))
      throw forbidden("Las tarjetas de regalo están disponibles desde el plan Negocio.");
    const before = programBasics(business);
    if (before.version !== input.version)
      throw conflict("La regla cambió en otra sesión. Recarga la configuración antes de guardar.");
    const patch =
      input.program_type === "DISCOUNT"
        ? { percent_off: input.percent_off }
        : input.program_type === "CASHBACK"
          ? { cashback_percent: input.cashback_percent }
          : input.program_type === "GIFT_CARD"
            ? { load_bonus_percent: Math.max(0, Math.min(100, input.load_bonus_percent ?? 0)) }
            : input.program_type === "STAMP"
              ? {
                  // The schema's superRefine requires stamps_required for STAMP programs.
                  stamps_required: /** @type {number} */ (input.stamps_required),
                  head_start: Math.min(
                    // The schema's superRefine requires stamps_required for STAMP programs.
                    /** @type {number} */ (input.stamps_required) - 1,
                    Math.max(0, input.head_start ?? 2),
                  ),
                  reward_label: (input.reward_label || "").trim(),
                  stamp_unit: input.stamp_unit ?? "visit",
                }
              : {
                  [rateKey[input.program_type]]: input.rate,
                  ...(input.program_type === "SPEND" ? { round: input.round } : {}),
                };
    const updated = await client.query(
      "UPDATE businesses SET program_type=$2,program_json=COALESCE(program_json,'{}'::jsonb)||$3::jsonb WHERE id=$1 RETURNING program_type,program_json",
      [options.businessId, input.program_type, JSON.stringify(patch)],
    );
    const after = programBasics(updated.rows[0]);
    await ensureStampReward(client, {
      businessId: options.businessId,
      programType: input.program_type,
      patch,
      priorRewardId: business.program_json?.stamp_reward_id ?? null,
    });
    await client.query(
      `INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta) VALUES($1,$2,'STAFF',$3,'program.launch.basics.update',$4,$5,$6)`,
      [
        randomUUID(),
        options.businessId,
        options.staffId,
        options.ip ?? null,
        options.ua ?? null,
        JSON.stringify(withImpersonationMeta({ before, after }, options)),
      ],
    );
    return { ok: true, program: after };
  });
}
