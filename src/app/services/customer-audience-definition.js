import { z } from "zod";
import { badRequest } from "../../utils/http-error.js";

const NumericRule = z.object({
  field: z.enum(["purchase_count", "spend_q", "last_purchase_days", "joined_days", "points_balance"]),
  operator: z.enum(["gte", "lte", "eq"]),
  value: z.number().finite().min(0).max(1000000000),
}).strict().refine(rule => rule.field === "spend_q"
  ? Math.abs(rule.value * 100 - Math.round(rule.value * 100)) <= 0.00001
  : Number.isInteger(rule.value));
const BooleanRule = z.object({
  field: z.enum(["has_purchase", "marketing_opt_in"]), operator: z.literal("eq"), value: z.boolean(),
}).strict();
const rule = z.union([NumericRule, BooleanRule]);
const group = minimum => z.object({ match: z.enum(["all", "any"]), rules: z.array(rule).min(minimum).max(8) }).strict();
export const AudienceDefinitionSchema = z.object({
  window_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
  include: group(1), exclude: group(0),
}).strict();

export function parseAudienceDefinition(value) {
  const result = AudienceDefinitionSchema.safeParse(value);
  if (!result.success) throw badRequest("Revisa las condiciones de la audiencia: campos disponibles, cantidades y grupos de hasta ocho reglas.");
  return result.data;
}
