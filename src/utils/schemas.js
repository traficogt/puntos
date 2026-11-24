import { dateTimeSchema } from "./date-time-schema.js";
import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy.js";

// Common schemas

// Preserve the original 8-4-4-4-12 hex contract for stored and client IDs;
// Zod 4's UUID validator additionally restricts RFC version/variant bits.
export const uuidSchema = z.guid();
export const emailSchema = z.string().email().max(255);
export const phoneSchema = z
  .string()
  .regex(/^\+502\d{8}$/, "Phone must be +502 followed by 8 digits");
export const slugSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens");
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);

// Program JSON validation schemas
export const spendProgramSchema = z.object({
  points_per_q: z.number().min(0).max(10),
  round: z.enum(["floor", "ceil", "round"]).optional().default("ceil"),
});

export const visitProgramSchema = z.object({
  points_per_visit: z.number().int().min(1).max(1000),
});

export const itemProgramSchema = z.object({
  points_per_item: z.number().int().min(1).max(1000),
});

// Meta field validation (max 10KB JSON)
export const metaSchema = z
  .record(z.string(), z.any())
  .refine((data) => JSON.stringify(data).length < 10000, "Meta field must be less than 10KB");

// Business schemas

export const businessRegisterSchema = z.object({
  name: z.string().min(3).max(140),
  slug: slugSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().min(8).max(30),
  category: z.string().max(50).optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  registration_token: z.string().min(16).optional(),
});

export const businessUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: phoneSchema.optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  points_per_quetzal: z.number().min(0).max(1000).optional(),
  points_per_visit: z.number().int().min(0).max(10000).optional(),
  points_per_item: z.number().int().min(0).max(10000).optional(),
});

const brandingHexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a 6-digit hex value")
  .transform((value) => value.toUpperCase());

/** @param {number} max */
function optionalTrimmedStringSchema(max) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().max(max).optional());
}

/** @param {number} max */
function optionalUrlSchema(max) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().url().max(max).optional());
}

function optionalHexColorSchema() {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, brandingHexColorSchema.optional());
}

export const businessCustomerBrandingSchema = z.object({
  branding_mode: z
    .enum(["platform_led", "endorsed_brand", "white_label_ready"])
    .default("endorsed_brand"),
  customer_program_name: optionalTrimmedStringSchema(120),
  customer_logo_url: optionalUrlSchema(1000).refine(
    (value) => value === undefined || /^https:\/\//i.test(value),
    { message: "El logo debe ser una URL https." },
  ),
  qr_logo_enabled: z.boolean().optional(),
  primary_color: optionalHexColorSchema(),
  accent_color: optionalHexColorSchema(),
  neutral_theme: z.enum(["warm", "neutral", "cool"]).optional(),
  powered_by_visible: z.boolean().default(true),
  wallet_headline: optionalTrimmedStringSchema(140),
  join_headline: optionalTrimmedStringSchema(140),
});

// Staff schemas

export const staffLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const staffCreateSchema = z.object({
  name: z.string().min(2).max(100),
  email: emailSchema,
  phone: z.string().max(30).optional(),
  password: passwordSchema,
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: uuidSchema.optional(),
  can_manage_gift_cards: z.boolean().optional(),
});

export const staffUpdateSchema = z.object({
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: uuidSchema.nullable().optional(),
  can_manage_gift_cards: z.boolean().optional(),
});

// Customer schemas

export const requestJoinCodeSchema = z.object({
  phone: z.string().min(6),
  email: emailSchema.optional(),
  name: z.string().max(120).optional(),
});

export const verifyJoinCodeSchema = z.object({
  phone: z.string().min(6),
  email: emailSchema.optional(),
  code: z.string().min(4).max(10),
  name: z.string().max(120).optional(),
  referralCode: z.string().length(6).optional(),
  marketingOptIn: z.boolean().optional(),
  // Optional source capability never makes an otherwise valid enrollment fail.
  visitToken: z
    .unknown()
    .optional()
    .transform((value) =>
      typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined,
    ),
});

export const customerUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: emailSchema.optional(),
});

// Backward-compatible aliases for older imports.
export const customerJoinSchema = requestJoinCodeSchema;
export const customerVerifySchema = verifyJoinCodeSchema;

// Transaction schemas

export const awardPointsSchema = z.object({
  customerQrToken: z.string().min(1),
  amount_q: z.number().min(0).max(1000000).optional(),
  visits: z.number().int().positive().max(1000).optional(),
  items: z.number().int().positive().max(10000).optional(),
  meta: z.record(z.string(), z.any()).optional(),
  txId: uuidSchema,
});

export const staffLookupCustomerSchema = z.object({
  customerQrToken: z.string().min(1),
});

export const syncAwardsSchema = z.object({
  awards: z
    .array(
      z.object({
        customerQrToken: z.string().min(1),
        amount_q: z.number().min(0).max(1000000).optional(),
        visits: z.number().int().min(0).max(1000).optional(),
        items: z.number().int().min(0).max(10000).optional(),
        meta: z.record(z.string(), z.any()).optional(),
        txId: uuidSchema,
        client_ts: z.string().optional(),
      }),
    )
    .max(200),
});

// Reward schemas

export const rewardCreateSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  points_cost: z.number().int().min(1).max(1000000),
  stock: z.number().int().min(0).optional(),
  valid_until: dateTimeSchema().optional(),
  active: z.boolean().default(true),
  branch_ids: z.array(uuidSchema).max(200).optional(),
});

export const rewardUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  points_cost: z.number().int().min(1).max(1000000).optional(),
  stock: z.number().int().min(0).optional(),
  valid_until: dateTimeSchema().optional(),
  active: z.boolean().optional(),
  branch_ids: z.array(uuidSchema).max(200).optional(),
});

export const redeemRewardSchema = z.object({
  customerId: uuidSchema,
  rewardId: uuidSchema,
  requestId: uuidSchema,
});

// Branch schemas

export const branchCreateSchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().max(255).optional(),
});

export const branchUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().max(255).optional(),
  active: z.boolean().optional(),
});

// Webhook schemas

export const webhookCreateSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16).max(255).optional(),
  active: z.boolean().default(true),
});

export const webhookUpdateSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().min(16).max(255).optional(),
  active: z.boolean().optional(),
});

// Query parameter schemas

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const optionalUuidSchema = z.preprocess((v) => {
  const normalized = Array.isArray(v) ? v[0] : v;
  if (normalized === "" || normalized === null || normalized === undefined) return undefined;
  return normalized;
}, z.guid().optional());

export const branchFilterQuerySchema = z.object({
  branch_id: optionalUuidSchema,
});

// Validation helpers

// Same user-facing text and code the error middleware uses for a ZodError that
// escapes a handler, so clients see one validation contract regardless of
// whether the schema ran as middleware or inside the handler.
export const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";
export const VALIDATION_FAILED_MESSAGE = "Revisa los datos enviados.";
export const INVALID_QUERY_MESSAGE = "Parámetros de consulta inválidos";
export const INVALID_PARAMS_MESSAGE = "Parámetros de ruta inválidos";

/** @param {z.ZodError} error */
export function zodIssueDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Body of a 400 validation response: `{ error, code, details }`.
 * @param {z.ZodError} error
 * @param {string} [message]
 */
export function validationErrorBody(error, message = VALIDATION_FAILED_MESSAGE) {
  return { error: message, code: VALIDATION_ERROR_CODE, details: zodIssueDetails(error) };
}

/**
 * Builds a validator factory for one request source. The parsed value is stored
 * on the request under `target`; a schema failure answers 400 with the issues.
 * @param {string} name Express layer name for the returned middleware
 * @param {"body" | "query" | "params"} source
 * @param {"validated" | "validatedQuery" | "validatedParams"} target
 * @param {string} message
 */
function validateSource(name, source, target, message) {
  /** @param {import("zod").ZodType} schema */
  return (schema) => {
    /**
     * Tests drive the validators with plain `{ body }` / `{ query }` / `{ params }`
     * objects, so the request contract is structural.
     * @param {{
     *   body?: unknown,
     *   query?: unknown,
     *   params?: unknown,
     *   validated?: unknown,
     *   validatedQuery?: unknown,
     *   validatedParams?: unknown,
     * }} req
     * @param {import("../types/http.js").JsonResponder} res
     * @param {import("express").NextFunction} next
     */
    const middleware = (req, res, next) => {
      try {
        req[target] = schema.parse(req[source]);
        return next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json(validationErrorBody(error, message));
        }
        return next(error);
      }
    };
    // Express records the function name as the layer name, which lets tests and
    // tooling locate the validation step in a route stack.
    Object.defineProperty(middleware, "name", { value: name });
    return middleware;
  };
}

/** Parses `req.body`; the result is available as `req.validated`. */
export const validateRequest = validateSource(
  "validateRequest",
  "body",
  "validated",
  VALIDATION_FAILED_MESSAGE,
);

/** Parses `req.query`; the result is available as `req.validatedQuery`. */
export const validateQuery = validateSource(
  "validateQuery",
  "query",
  "validatedQuery",
  INVALID_QUERY_MESSAGE,
);

/** Parses `req.params`; the result is available as `req.validatedParams`. */
export const validateParams = validateSource(
  "validateParams",
  "params",
  "validatedParams",
  INVALID_PARAMS_MESSAGE,
);

/** Route parameter schema for a single `:id` segment that must be a UUID. */
export const uuidParamsSchema = z.object({ id: uuidSchema });
