import { z } from "zod";
import { hasMaxScale } from "../../utils/money.js";
export const MeasurementPlanInput = z
  .object({
    version: z.literal(1).optional(),
    baseline_return_rate_pct: z.number().finite().min(1).max(95),
    minimum_detectable_lift_pp: z.number().finite().positive().max(50),
    observation_days: z.number().int().min(7).max(180),
    reconciliation_days: z.number().int().min(0).max(30).default(7),
  })
  .strict()
  .refine((v) => v.baseline_return_rate_pct + v.minimum_detectable_lift_pp < 100);
const amount = z
  .number()
  .finite()
  .min(0)
  .max(999999999.99)
  .refine((v) => hasMaxScale(v, 2))
  .nullable()
  .default(null);
export const MeasurementCostInput = z
  .object({
    gross_margin_pct: z.number().finite().min(0).max(100).nullable().default(null),
    fulfillment_cost_q: amount,
    messaging_cost_q: amount,
    other_cost_q: amount,
    outstanding_reward_cost_q: amount,
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
