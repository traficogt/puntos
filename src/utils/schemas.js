import { z } from "zod";

// Common schemas

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email().max(255);
export const phoneSchema = z.string().regex(/^\+502\d{8}$/, "Phone must be +502 followed by 8 digits");
export const slugSchema = z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens");
export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password must not exceed 100 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

// Program JSON validation schemas
export const spendProgramSchema = z.object({
  points_per_q: z.number().min(0).max(10),
  round: z.enum(['floor', 'ceil', 'round']).optional().default('ceil')
});

export const visitProgramSchema = z.object({
  points_per_visit: z.number().int().min(1).max(1000)
});

export const itemProgramSchema = z.object({
  points_per_item: z.number().int().min(1).max(1000)
});

// Meta field validation (max 10KB JSON)
export const metaSchema = z.record(z.any()).refine(
  (data) => JSON.stringify(data).length < 10000,
  "Meta field must be less than 10KB"
);

// Business schemas

export const businessRegisterSchema = z.object({
  name: z.string().min(2).max(100),
  slug: slugSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).default("SPEND"),
  points_per_quetzal: z.number().min(0).max(1000).optional(),
  points_per_visit: z.number().int().min(0).max(10000).optional(),
  points_per_item: z.number().int().min(0).max(10000).optional()
});

export const businessUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: phoneSchema.optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  points_per_quetzal: z.number().min(0).max(1000).optional(),
  points_per_visit: z.number().int().min(0).max(10000).optional(),
  points_per_item: z.number().int().min(0).max(10000).optional()
});

// Staff schemas

export const staffLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6)
});

export const staffCreateSchema = z.object({
  name: z.string().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(["OWNER", "MANAGER", "STAFF"]),
  branch_id: uuidSchema.optional()
});

export const staffUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  role: z.enum(["OWNER", "MANAGER", "STAFF"]).optional(),
  branch_id: uuidSchema.optional(),
  active: z.boolean().optional()
});

// Customer schemas

export const customerJoinSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(100),
  phone: phoneSchema
});

export const customerVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  slug: slugSchema
});

export const customerUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: emailSchema.optional()
});

// Transaction schemas

export const awardPointsSchema = z.object({
  customerQrToken: z.string().min(1),
  amount_q: z.number().min(0).max(1000000).optional(),
  visits: z.number().int().min(0).max(1000).optional(),
  items: z.number().int().min(0).max(10000).optional(),
  source: z.enum(["online", "offline"]).default("online"),
  meta: z.record(z.any()).optional(),
  txId: uuidSchema.optional()
});

export const syncAwardsSchema = z.object({
  awards: z.array(z.object({
    customerQrToken: z.string().min(1),
    amount_q: z.number().min(0).max(1000000).optional(),
    visits: z.number().int().min(0).max(1000).optional(),
    items: z.number().int().min(0).max(10000).optional(),
    meta: z.record(z.any()).optional(),
    txId: uuidSchema,
    client_ts: z.string().optional()
  })).max(200)
});

// Reward schemas

export const rewardCreateSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  points_cost: z.number().int().min(1).max(1000000),
  stock: z.number().int().min(0).optional(),
  valid_until: z.string().datetime().optional(),
  active: z.boolean().default(true),
  branch_ids: z.array(uuidSchema).max(200).optional()
});

export const rewardUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  points_cost: z.number().int().min(1).max(1000000).optional(),
  stock: z.number().int().min(0).optional(),
  valid_until: z.string().datetime().optional(),
  active: z.boolean().optional(),
  branch_ids: z.array(uuidSchema).max(200).optional()
});

export const redeemRewardSchema = z.object({
  customerId: uuidSchema,
  rewardId: uuidSchema
});

// Branch schemas

export const branchCreateSchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().max(255).optional()
});

export const branchUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().max(255).optional(),
  active: z.boolean().optional()
});

// Webhook schemas

export const webhookCreateSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16).max(255).optional(),
  active: z.boolean().default(true)
});

export const webhookUpdateSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().min(16).max(255).optional(),
  active: z.boolean().optional()
});

// Query parameter schemas

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30)
});

export const optionalUuidSchema = z.preprocess(
  (v) => {
    const normalized = Array.isArray(v) ? v[0] : v;
    if (normalized === "" || normalized === null || normalized === undefined) return undefined;
    return normalized;
  },
  z.string().uuid().optional()
);

export const branchFilterQuerySchema = z.object({
  branch_id: optionalUuidSchema
});

// Validation helpers

export function validateRequest(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: error.errors.map(e => ({
            field: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(error);
    }
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.validatedQuery = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid query parameters",
          details: error.errors.map(e => ({
            field: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(error);
    }
  };
}
