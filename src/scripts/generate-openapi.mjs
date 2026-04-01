#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  awardPointsSchema,
  requestJoinCodeSchema,
  rewardCreateSchema,
  rewardUpdateSchema,
  staffLoginSchema,
  verifyJoinCodeSchema
} from "../utils/schemas.js";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));

process.env.NODE_ENV ||= "test";
process.env.APP_ORIGIN ||= "http://localhost:3001";
process.env.CORS_ORIGIN ||= "http://localhost:3001";
process.env.DB_HOST ||= "localhost";
process.env.DB_NAME ||= "puntos";
process.env.DB_USER ||= "docs";
process.env.DB_PASSWORD ||= "docs-build-placeholder-db-password";
process.env.JWT_SECRET ||= "docs-build-placeholder-jwt";

const { BranchSchema } = await import("../app/routes/admin/branches.js");
const {
  ProgramSchema,
  AutomationTemplateSchema,
  CampaignRulesSchema,
  ExternalAwardsSchema
} = await import("../app/routes/admin/program-support.js");
const { StaffCreateSchema, StaffUpdateSchema } = await import("../app/routes/admin/staff.js");
const { WebhookSchema } = await import("../app/routes/admin/webhooks.js");
const {
  CohortRetentionQuerySchema,
  TopCustomersQuerySchema
} = await import("../app/routes/analytics/cohorts.js");
const {
  CreateSegmentSchema,
  SegmentCustomersQuerySchema
} = await import("../app/routes/analytics/segments.js");
const {
  CreateGiftCardSchema,
  GiftCardListQuerySchema,
  RedeemGiftCardSchema
} = await import("../app/routes/gift-card-routes.js");
const {
  AchievementCreateSchema,
  AchievementUpdateSchema,
  ChallengeCreateSchema,
  ChallengeUpdateSchema
} = await import("../app/routes/gamification-support.js");
const {
  PaymentWebhookListQuerySchema,
  ResolveSchema
} = await import("../app/routes/payment-webhook-routes.js");
const { ExternalAwardSchema } = await import("../app/routes/public-routes.js");
const {
  LoginSchema,
  UpdatePlanSchema,
  UpdatePlanFeaturesSchema,
  CreateBusinessSchema,
  CreateBusinessUserSchema
} = await import("../app/routes/super-support.js");
const { RedeemSchema, RefundSchema, SyncSchema } = await import("../app/routes/staff-routes.js");
const { TierCreateSchema, TierUpdateSchema } = await import("../app/routes/tier-routes.js");

/** @type {(schema: import("zod").ZodTypeAny, name?: string) => any} */
const toJsonSchema = /** @type {any} */ (zodToJsonSchema);

const TimestampSchema = z.string();
const JsonRecordSchema = z.record(z.any());

function okEnvelope(dataShape = {}) {
  return z.object({
    ok: z.literal(true),
    ...dataShape
  });
}

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional()
});

const BranchResourceSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid().optional(),
  name: z.string(),
  address: z.string().nullable().optional(),
  code: z.string(),
  created_at: TimestampSchema.optional()
}).passthrough();

const StaffResourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  role: z.string(),
  branch_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  can_manage_gift_cards: z.boolean().optional(),
  created_at: TimestampSchema.optional()
}).passthrough();

const WebhookEndpointResourceSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid().optional(),
  url: z.string().url(),
  events: z.array(z.string()),
  active: z.boolean(),
  created_at: TimestampSchema.optional(),
  secret_masked: z.string().nullable().optional(),
  has_secret: z.boolean().optional()
}).passthrough();

const GiftCardResourceSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  code: z.string(),
  qr_token: z.string().optional(),
  issued_to_name: z.string().nullable().optional(),
  issued_to_phone: z.string().nullable().optional(),
  initial_amount_q: z.union([z.number(), z.string()]),
  balance_q: z.union([z.number(), z.string()]),
  status: z.string(),
  expires_at: TimestampSchema.nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: TimestampSchema.optional(),
  updated_at: TimestampSchema.optional()
}).passthrough();

const GiftCardTransactionResourceSchema = z.object({
  id: z.string().uuid(),
  gift_card_id: z.string().uuid(),
  business_id: z.string().uuid(),
  staff_user_id: z.string().uuid().nullable().optional(),
  tx_type: z.string(),
  amount_q: z.union([z.number(), z.string()]),
  balance_after_q: z.union([z.number(), z.string()]),
  meta: JsonRecordSchema.optional(),
  created_at: TimestampSchema.optional()
}).passthrough();

const RewardResourceSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  points_cost: z.number(),
  active: z.boolean(),
  stock: z.number().nullable().optional(),
  valid_until: TimestampSchema.nullable().optional(),
  created_at: TimestampSchema.optional(),
  branch_ids: z.array(z.string().uuid()).optional()
}).passthrough();

const PaymentWebhookEventResourceSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  provider_event_id: z.string(),
  event_type: z.string().nullable().optional(),
  business_slug: z.string().nullable().optional(),
  business_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  amount_q: z.union([z.number(), z.string()]),
  currency: z.string().nullable().optional(),
  status: z.string(),
  reason: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  linked_transaction_id: z.string().uuid().nullable().optional(),
  created_at: TimestampSchema.optional(),
  updated_at: TimestampSchema.optional()
}).passthrough();

const PaymentWebhookResolveResponseSchema = okEnvelope({
  event: PaymentWebhookEventResourceSchema.optional(),
  transaction: JsonRecordSchema.optional()
}).passthrough();

const LedgerCertificationDailyRowSchema = z.object({
  date: z.string(),
  points_issued: z.number(),
  points_redeemed: z.number(),
  points_reversed: z.number(),
  points_expired: z.number(),
  adjustment_points: z.number(),
  gift_cards_issued_q: z.number(),
  gift_cards_redeemed_q: z.number(),
  replay_events: z.number()
});

const LedgerCertificationResponseSchema = okEnvelope({
  business: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string()
  }),
  generated_at: TimestampSchema,
  period: z.object({
    from: z.string(),
    to: z.string()
  }),
  certification_status: z.enum(["OK", "REVIEW_REQUIRED"]),
  summary: z.object({
    points_issued: z.number(),
    points_redeemed: z.number(),
    points_reversed: z.number(),
    points_expired: z.number(),
    adjustment_points: z.number(),
    gift_cards_issued_q: z.number(),
    gift_cards_redeemed_q: z.number(),
    replay_events: z.number(),
    pending_corrections_count: z.number(),
    negative_balance_count: z.number(),
    latest_reconciliation_mismatches: z.number(),
    latest_reconciliation_completed_at: TimestampSchema.nullable()
  }),
  daily_rows: z.array(LedgerCertificationDailyRowSchema)
}).passthrough();

const StaffAwardResponseSchema = okEnvelope({
  pointsAwarded: z.number(),
  newBalance: z.number(),
  newPendingBalance: z.number().optional(),
  customerId: z.string().uuid(),
  transactionId: z.string().uuid(),
  status: z.string().optional(),
  availableAt: TimestampSchema.nullable().optional()
}).passthrough();

const StaffRefundResponseSchema = okEnvelope({
  transactionId: z.string().uuid(),
  reversalTransactionId: z.string().uuid(),
  customerId: z.string().uuid(),
  pointsEffect: z.number(),
  gamificationReconciliation: z.object({
    achievementsRevoked: z.number(),
    challengesRevoked: z.number()
  }),
  newBalance: z.number(),
  newPendingBalance: z.number()
}).passthrough();

const schemas = {
  StaffLoginRequest: staffLoginSchema,
  AwardPointsRequest: awardPointsSchema,
  StaffRedeemRequest: RedeemSchema,
  StaffSyncAwardsRequest: SyncSchema,
  StaffRefundRequest: RefundSchema,
  RequestJoinCodeRequest: requestJoinCodeSchema,
  VerifyJoinCodeRequest: verifyJoinCodeSchema,
  PublicExternalAwardRequest: ExternalAwardSchema,
  SuperLoginRequest: LoginSchema,
  SuperPlanUpdateRequest: UpdatePlanSchema,
  SuperPlanFeaturesRequest: UpdatePlanFeaturesSchema,
  SuperCreateBusinessRequest: CreateBusinessSchema,
  SuperCreateBusinessUserRequest: CreateBusinessUserSchema,
  BusinessPublicResponse: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    category: z.string().nullable().optional(),
    program_type: z.enum(["SPEND", "VISIT", "ITEM"])
  }),
  CustomerProfileResponse: z.object({
    ok: z.literal(true),
    business: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string()
    }),
    customer: z.object({
      id: z.string(),
      phone: z.string(),
      name: z.string().nullable(),
      points: z.number(),
      pending_points: z.number(),
      lifetime_points: z.number(),
      created_at: z.string(),
      last_visit_at: z.string().nullable()
    })
  }),
  ReferralCodeResponse: z.object({
    ok: z.literal(true),
    referral_code: z.string()
  }),
  TierInfoResponse: z.object({
    ok: z.literal(true),
    tier: z.record(z.any())
  }),
  AchievementCreateRequest: AchievementCreateSchema,
  AchievementUpdateRequest: AchievementUpdateSchema,
  ChallengeCreateRequest: ChallengeCreateSchema,
  ChallengeUpdateRequest: ChallengeUpdateSchema,
  TierCreateRequest: TierCreateSchema,
  TierUpdateRequest: TierUpdateSchema,
  RewardCreateRequest: rewardCreateSchema,
  RewardUpdateRequest: rewardUpdateSchema,
  BranchCreateRequest: BranchSchema,
  StaffCreateRequest: StaffCreateSchema,
  StaffUpdateRequest: StaffUpdateSchema,
  WebhookCreateRequest: WebhookSchema,
  RewardResource: RewardResourceSchema,
  GiftCardCreateRequest: CreateGiftCardSchema,
  GiftCardRedeemRequest: RedeemGiftCardSchema,
  AnalyticsSegmentCreateRequest: CreateSegmentSchema,
  PaymentWebhookResolveRequest: ResolveSchema,
  ProgramUpdateRequest: ProgramSchema,
  CampaignRulesRequest: CampaignRulesSchema,
  ExternalAwardsRequest: ExternalAwardsSchema,
  AutomationTemplateRequest: AutomationTemplateSchema,
  GiftCardListQuery: GiftCardListQuerySchema,
  AnalyticsSegmentCustomersQuery: SegmentCustomersQuerySchema,
  AnalyticsCohortsQuery: CohortRetentionQuerySchema,
  AnalyticsTopCustomersQuery: TopCustomersQuerySchema,
  PaymentWebhookListQuery: PaymentWebhookListQuerySchema,
  ErrorResponse: ErrorResponseSchema,
  LedgerCertificationResponse: LedgerCertificationResponseSchema,
  BranchResource: BranchResourceSchema,
  BranchListResponse: okEnvelope({
    branches: z.array(BranchResourceSchema)
  }),
  BranchDetailResponse: okEnvelope({
    branch: BranchResourceSchema
  }),
  StaffResource: StaffResourceSchema,
  StaffListResponse: okEnvelope({
    staff: z.array(StaffResourceSchema)
  }),
  StaffDetailResponse: okEnvelope({
    staff: StaffResourceSchema
  }),
  WebhookEndpointResource: WebhookEndpointResourceSchema,
  WebhookListResponse: okEnvelope({
    endpoints: z.array(WebhookEndpointResourceSchema)
  }),
  WebhookDetailResponse: okEnvelope({
    endpoint: WebhookEndpointResourceSchema
  }),
  RewardListResponse: okEnvelope({
    rewards: z.array(RewardResourceSchema)
  }),
  RewardDetailResponse: okEnvelope({
    reward: RewardResourceSchema
  }),
  GiftCardResource: GiftCardResourceSchema,
  GiftCardTransactionResource: GiftCardTransactionResourceSchema,
  GiftCardListResponse: okEnvelope({
    gift_cards: z.array(GiftCardResourceSchema)
  }),
  GiftCardDetailResponse: okEnvelope({
    gift_card: GiftCardResourceSchema
  }),
  GiftCardLookupResponse: okEnvelope({
    card: GiftCardResourceSchema,
    transactions: z.array(GiftCardTransactionResourceSchema)
  }),
  PaymentWebhookEventResource: PaymentWebhookEventResourceSchema,
  PaymentWebhookListResponse: okEnvelope({
    events: z.array(PaymentWebhookEventResourceSchema)
  }),
  PaymentWebhookResolveResponse: PaymentWebhookResolveResponseSchema,
  AnalyticsSegmentCustomersResponse: okEnvelope({
    customers: z.array(JsonRecordSchema),
    limit: z.number(),
    offset: z.number()
  }),
  StaffAwardResponse: StaffAwardResponseSchema,
  StaffRefundResponse: StaffRefundResponseSchema
};

function toComponentSchema(schema, name) {
  const jsonSchema = toJsonSchema(/** @type {import("zod").ZodTypeAny} */ (schema), name);
  if (jsonSchema?.definitions?.[name]) return jsonSchema.definitions[name];
  return jsonSchema;
}

const components = {};
for (const [name, schema] of Object.entries(schemas)) {
  components[name] = toComponentSchema(schema, name);
}

function schemaRef(name) {
  return { $ref: `#/components/schemas/${name}` };
}

const routeSchemaBindings = {
  "/api/v1/staff/login": {
    post: { body: "StaffLoginRequest" }
  },
  "/api/v1/staff/award": {
    post: {
      body: "AwardPointsRequest",
      responses: { "200": "StaffAwardResponse" }
    }
  },
  "/api/v1/staff/redeem": {
    post: { body: "StaffRedeemRequest" }
  },
  "/api/v1/staff/sync": {
    post: { body: "StaffSyncAwardsRequest" }
  },
  "/api/v1/staff/refund": {
    post: {
      body: "StaffRefundRequest",
      responses: { "200": "StaffRefundResponse" }
    }
  },
  "/api/v1/public/business/{slug}/join/request-code": {
    post: { body: "RequestJoinCodeRequest" }
  },
  "/api/v1/public/business/{slug}/join/verify": {
    post: { body: "VerifyJoinCodeRequest" }
  },
  "/api/v1/public/external/award": {
    post: { body: "PublicExternalAwardRequest" }
  },
  "/api/v1/super/login": {
    post: { body: "SuperLoginRequest" }
  },
  "/api/v1/super/plans/{plan}/features": {
    put: { body: "SuperPlanFeaturesRequest" }
  },
  "/api/v1/super/businesses": {
    post: { body: "SuperCreateBusinessRequest" }
  },
  "/api/v1/super/businesses/{businessId}/plan": {
    put: { body: "SuperPlanUpdateRequest" }
  },
  "/api/v1/super/businesses/{businessId}/users": {
    post: { body: "SuperCreateBusinessUserRequest" }
  },
  "/api/v1/admin/tiers": {
    post: { body: "TierCreateRequest" }
  },
  "/api/v1/admin/tiers/{id}": {
    put: { body: "TierUpdateRequest" }
  },
  "/api/v1/admin/rewards": {
    get: { responses: { "200": "RewardListResponse" } },
    post: {
      body: "RewardCreateRequest",
      responses: { "200": "RewardDetailResponse" }
    }
  },
  "/api/v1/admin/rewards/{id}": {
    patch: {
      body: "RewardUpdateRequest",
      responses: { "200": "RewardDetailResponse" }
    }
  },
  "/api/v1/admin/branches": {
    get: { responses: { "200": "BranchListResponse" } },
    post: {
      body: "BranchCreateRequest",
      responses: { "200": "BranchDetailResponse" }
    }
  },
  "/api/v1/admin/staff": {
    get: { responses: { "200": "StaffListResponse" } },
    post: {
      body: "StaffCreateRequest",
      responses: { "200": "StaffDetailResponse" }
    }
  },
  "/api/v1/admin/staff/{id}": {
    patch: {
      body: "StaffUpdateRequest",
      responses: { "200": "StaffDetailResponse" }
    }
  },
  "/api/v1/admin/webhooks": {
    get: { responses: { "200": "WebhookListResponse" } },
    post: {
      body: "WebhookCreateRequest",
      responses: { "200": "WebhookDetailResponse" }
    }
  },
  "/api/v1/admin/gift-cards": {
    get: {
      query: "GiftCardListQuery",
      responses: { "200": "GiftCardListResponse" }
    },
    post: {
      body: "GiftCardCreateRequest",
      responses: { "201": "GiftCardDetailResponse" }
    }
  },
  "/api/v1/staff/gift-cards/redeem": {
    post: {
      body: "GiftCardRedeemRequest",
      responses: { "200": "GiftCardDetailResponse" }
    }
  },
  "/api/v1/staff/gift-cards/{codeOrToken}": {
    get: { responses: { "200": "GiftCardLookupResponse" } }
  },
  "/api/v1/admin/achievements": {
    post: { body: "AchievementCreateRequest" }
  },
  "/api/v1/admin/achievements/{id}": {
    patch: { body: "AchievementUpdateRequest" }
  },
  "/api/v1/admin/challenges": {
    post: { body: "ChallengeCreateRequest" }
  },
  "/api/v1/admin/challenges/{id}": {
    patch: { body: "ChallengeUpdateRequest" }
  },
  "/api/v1/admin/program": {
    put: { body: "ProgramUpdateRequest" }
  },
  "/api/v1/admin/program/automations/apply-template": {
    post: { body: "AutomationTemplateRequest" }
  },
  "/api/v1/admin/program/campaign-rules": {
    put: { body: "CampaignRulesRequest" }
  },
  "/api/v1/admin/program/external-awards": {
    put: { body: "ExternalAwardsRequest" }
  },
  "/api/v1/admin/analytics/cohorts": {
    get: { query: "AnalyticsCohortsQuery" }
  },
  "/api/v1/admin/analytics/top-customers": {
    get: { query: "AnalyticsTopCustomersQuery" }
  },
  "/api/v1/admin/analytics/segments": {
    post: { body: "AnalyticsSegmentCreateRequest" }
  },
  "/api/v1/admin/analytics/segments/{id}": {
    get: {
      query: "AnalyticsSegmentCustomersQuery",
      responses: { "200": "AnalyticsSegmentCustomersResponse" }
    }
  },
  "/api/v1/admin/payment-webhooks": {
    get: {
      query: "PaymentWebhookListQuery",
      responses: { "200": "PaymentWebhookListResponse" }
    }
  },
  "/api/v1/admin/payment-webhooks/{id}/resolve": {
    post: {
      body: "PaymentWebhookResolveRequest",
      responses: { "200": "PaymentWebhookResolveResponse" }
    }
  },
  "/api/v1/admin/analytics/ledger-certification": {
    get: {
      responses: { "200": "LedgerCertificationResponse" }
    }
  }
};

const curatedPaths = {
  "/api/v1/health": {
    get: {
      summary: "Service health probe",
      responses: {
        "200": { description: "Service healthy" },
        "503": { description: "Service unhealthy" }
      }
    }
  },
  "/api/v1/ready": {
    get: {
      summary: "Readiness probe",
      responses: {
        "200": { description: "Ready for traffic" },
        "503": { description: "Not ready" }
      }
    }
  },
  "/api/v1/live": {
    get: {
      summary: "Liveness probe",
      responses: {
        "200": { description: "Process is alive" }
      }
    }
  },
  "/api/v1/info": {
    get: {
      summary: "Service metadata",
      responses: {
        "200": { description: "Version and runtime info" }
      }
    }
  },
  "/api/v1/staff/login": {
    post: {
      summary: "Staff login",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/StaffLoginRequest" } }
        }
      },
      responses: {
        "200": { description: "Authenticated; cookie __Host-pf_staff is set" },
        "400": { description: "Validation error" },
        "401": { description: "Invalid credentials" }
      }
    }
  },
  "/api/v1/super/login": {
    post: {
      summary: "Super admin login",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperLoginRequest" } }
        }
      },
      responses: {
        "200": { description: "Authenticated; cookie __Host-pf_super is set" },
        "400": { description: "Validation error" },
        "401": { description: "Invalid credentials" },
        "403": { description: "Super admin not configured" }
      }
    }
  },
  "/api/v1/super/me": {
    get: {
      summary: "Current super admin session",
      security: [{ superAuth: [] }],
      responses: {
        "200": { description: "Current super admin session" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/staff/me": {
    get: {
      summary: "Current staff session",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Current staff session" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/staff/award": {
    post: {
      summary: "Award points to a customer",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AwardPointsRequest" } }
        }
      },
      responses: {
        "200": { description: "Points awarded" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Permission denied" }
      }
    }
  },
  "/api/v1/public/business/{slug}": {
    get: {
      summary: "Get a business public profile by slug",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      responses: {
        "200": {
          description: "Business public profile",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/BusinessPublicResponse" } }
          }
        },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/public/business/{slug}/join/request-code": {
    post: {
      summary: "Request a customer join verification code",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/RequestJoinCodeRequest" } }
        }
      },
      responses: {
        "200": { description: "Verification code requested" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" },
        "429": { description: "Rate limited" }
      }
    }
  },
  "/api/v1/public/business/{slug}/join/verify": {
    post: {
      summary: "Verify a join code and create/login the customer",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/VerifyJoinCodeRequest" } }
        }
      },
      responses: {
        "200": { description: "Customer authenticated; cookie __Host-pf_customer is set" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" },
        "429": { description: "Rate limited" }
      }
    }
  },
  "/api/v1/public/customer/qr.svg": {
    get: {
      summary: "Get a short-lived customer QR as SVG",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "SVG QR image with X-QR-Exp and X-QR-JTI headers",
          content: {
            "image/svg+xml": {
              schema: { type: "string" }
            }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/me": {
    get: {
      summary: "Get the current customer profile",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Current customer profile",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CustomerProfileResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    },
    delete: {
      summary: "Delete the current customer account",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer account deleted" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/history": {
    get: {
      summary: "Get the current customer's transaction and redemption history",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer history" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/rewards": {
    get: {
      summary: "List rewards available to the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Available rewards" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/customer/export": {
    get: {
      summary: "Export the current customer's data",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer data export" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/customer/referral-code": {
    get: {
      summary: "Get or create the current customer's referral code",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Referral code",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ReferralCodeResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/tier": {
    get: {
      summary: "Get the current customer's tier information",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Tier info",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/TierInfoResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/admin/tiers": {
    get: {
      summary: "List business tiers",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Tier list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    },
    post: {
      summary: "Create a business tier",
      security: [{ staffAuth: [] }],
      responses: {
        "201": { description: "Tier created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    }
  },
  "/api/v1/admin/plan": {
    get: {
      summary: "Get the current business plan, limits, and features",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Plan detail" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/admin/rewards": {
    get: {
      summary: "List rewards for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Reward list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    },
    post: {
      summary: "Create a reward",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Reward created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    }
  },
  "/api/v1/admin/rewards/{id}": {
    patch: {
      summary: "Update reward properties such as active state or points cost",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Reward updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "404": { description: "Reward not found" }
      }
    }
  },
  "/api/v1/admin/branches": {
    get: {
      summary: "List branches for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Branch list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    },
    post: {
      summary: "Create a branch",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Branch created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    }
  },
  "/api/v1/admin/staff": {
    get: {
      summary: "List staff users for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Staff list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Role not allowed" }
      }
    },
    post: {
      summary: "Create a staff user",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Staff user created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Role not allowed" },
        "409": { description: "Email already registered" }
      }
    }
  },
  "/api/v1/admin/staff/{id}": {
    patch: {
      summary: "Update a staff user",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Staff user updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Role not allowed" },
        "404": { description: "Staff user not found" }
      }
    }
  },
  "/api/v1/admin/webhooks": {
    get: {
      summary: "List webhook endpoints for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Webhook endpoint list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Role not allowed" }
      }
    },
    post: {
      summary: "Create a webhook endpoint",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Webhook endpoint created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Role not allowed" }
      }
    }
  },
  "/api/v1/admin/gift-cards": {
    get: {
      summary: "List gift cards for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Gift card list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    },
    post: {
      summary: "Create a gift card",
      security: [{ staffAuth: [] }],
      responses: {
        "201": { description: "Gift card created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" }
      }
    }
  },
  "/api/v1/staff/gift-cards/{codeOrToken}": {
    get: {
      summary: "Look up a gift card by code or QR token",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "codeOrToken",
          required: true,
          schema: { type: "string" }
        }
      ],
      responses: {
        "200": { description: "Gift card detail" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled or role not allowed" },
        "404": { description: "Gift card not found" }
      }
    }
  },
  "/api/v1/super/plans": {
    get: {
      summary: "List configurable plans",
      security: [{ superAuth: [] }],
      responses: {
        "200": { description: "Available plan configuration" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/super/plans/{plan}/features": {
    put: {
      summary: "Update plan feature flags",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "plan",
          required: true,
          schema: { type: "string" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperPlanFeaturesRequest" } }
        }
      },
      responses: {
        "200": { description: "Updated plan features" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/super/businesses": {
    get: {
      summary: "List businesses visible to the super admin",
      security: [{ superAuth: [] }],
      responses: {
        "200": { description: "Business list" },
        "401": { description: "Not authenticated" }
      }
    },
    post: {
      summary: "Create a business and owner from the super admin panel",
      security: [{ superAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperCreateBusinessRequest" } }
        }
      },
      responses: {
        "201": { description: "Business created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/super/businesses/{businessId}/plan": {
    put: {
      summary: "Update a business plan",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "businessId",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperPlanUpdateRequest" } }
        }
      },
      responses: {
        "200": { description: "Business plan updated" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/super/businesses/{businessId}/users": {
    get: {
      summary: "List staff users for a business",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "businessId",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Business user list" },
        "404": { description: "Business not found" }
      }
    },
    post: {
      summary: "Create a staff user for a business",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "businessId",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperCreateBusinessUserRequest" } }
        }
      },
      responses: {
        "201": { description: "Business user created" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" },
        "409": { description: "Email already registered" }
      }
    }
  },
  "/api/v1/super/impersonate/{businessId}": {
    post: {
      summary: "Impersonate the first active OWNER or MANAGER for a business",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "businessId",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Impersonation cookie issued" },
        "404": { description: "No eligible staff user found" }
      }
    }
  },
  "/api/v1/admin/analytics/calculate": {
    post: {
      summary: "Queue an analytics recalculation job",
      security: [{ staffAuth: [] }],
      responses: {
        "202": { description: "Analytics recalculation queued" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    }
  },
  "/api/v1/admin/jobs": {
    get: {
      summary: "List background jobs for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Background jobs list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    }
  },
  "/api/v1/admin/jobs/{id}": {
    get: {
      summary: "Get a single background job",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Background job details" },
        "404": { description: "Job not found" }
      }
    }
  },
  "/api/v1/customer/achievements": {
    get: {
      summary: "Get earned and in-progress achievements for the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer achievements" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/customer/challenges": {
    get: {
      summary: "Get active challenges and progress for the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer challenges" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/customer/streak": {
    get: {
      summary: "Get the current customer's visit streak",
      security: [{ customerAuth: [] }],
      responses: {
        "200": { description: "Customer streak" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/customer/leaderboard/{type}": {
    get: {
      summary: "Get the current customer's leaderboard position",
      security: [{ customerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "type",
          required: true,
          schema: { type: "string", enum: ["points", "streak"] }
        }
      ],
      responses: {
        "200": { description: "Leaderboard position" },
        "400": { description: "Invalid leaderboard type" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/admin/achievements": {
    get: {
      summary: "List gamification achievements for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Achievement list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    },
    post: {
      summary: "Create a gamification achievement",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AchievementCreateRequest" } }
        }
      },
      responses: {
        "201": { description: "Achievement created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" }
      }
    }
  },
  "/api/v1/admin/achievements/{id}": {
    put: {
      summary: "Update an achievement",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AchievementUpdateRequest" } }
        }
      },
      responses: {
        "200": { description: "Achievement updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" }
      }
    },
    delete: {
      summary: "Delete an achievement",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Achievement deleted" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Achievement not found" }
      }
    }
  },
  "/api/v1/admin/challenges": {
    get: {
      summary: "List active challenges for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Challenge list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    },
    post: {
      summary: "Create a challenge",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ChallengeCreateRequest" } }
        }
      },
      responses: {
        "201": { description: "Challenge created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" }
      }
    }
  },
  "/api/v1/admin/challenges/{id}": {
    put: {
      summary: "Update a challenge",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ChallengeUpdateRequest" } }
        }
      },
      responses: {
        "200": { description: "Challenge updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Challenge not found" }
      }
    },
    delete: {
      summary: "Delete a challenge",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Challenge deleted" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Challenge not found" }
      }
    }
  },
  "/api/v1/admin/leaderboard/{type}": {
    get: {
      summary: "Get an admin leaderboard for the current business",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "type",
          required: true,
          schema: { type: "string", enum: ["points", "streak"] }
        }
      ],
      responses: {
        "200": { description: "Leaderboard data" },
        "400": { description: "Invalid leaderboard type" },
        "401": { description: "Not authenticated" },
        "403": { description: "Plan feature not enabled" }
      }
    }
  },
  "/api/v1/admin/program": {
    get: {
      summary: "Get the current program configuration",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Program configuration" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    },
    post: {
      summary: "Update the current program configuration",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ProgramUpdateRequest" } }
        }
      },
      responses: {
        "200": { description: "Program updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role, permission, and plan feature required" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/admin/automations": {
    get: {
      summary: "Get lifecycle automation settings and templates",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Automation settings" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/admin/automations/template": {
    put: {
      summary: "Apply a lifecycle automation template",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AutomationTemplateRequest" } }
        }
      },
      responses: {
        "200": { description: "Automation template applied" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/admin/campaign-rules": {
    get: {
      summary: "Get campaign rules for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Campaign rules" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    },
    put: {
      summary: "Update campaign rules for the current business",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/CampaignRulesRequest" } }
        }
      },
      responses: {
        "200": { description: "Campaign rules updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/admin/external-awards": {
    get: {
      summary: "Get external award integration settings",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "External awards configuration" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    },
    put: {
      summary: "Update external award integration settings",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ExternalAwardsRequest" } }
        }
      },
      responses: {
        "200": { description: "External awards updated" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and plan feature required" },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/admin/analytics/dashboard": {
    get: {
      summary: "Get analytics dashboard aggregates for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Analytics dashboard" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/customer/{id}": {
    get: {
      summary: "Get a customer 360 profile for analytics",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Customer analytics profile" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" },
        "404": { description: "Customer not found" }
      }
    }
  },
  "/api/v1/admin/analytics/churn-risk": {
    get: {
      summary: "List high churn-risk customers",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "High churn-risk customers" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/cohorts": {
    get: {
      summary: "Get cohort retention data",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Cohort retention data" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/top-customers": {
    get: {
      summary: "List top customers by LTV",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Top customers" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/rfm": {
    get: {
      summary: "Get RFM distribution for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "RFM distribution" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/segments": {
    get: {
      summary: "List analytics segments",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Segment list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    },
    post: {
      summary: "Create an analytics segment",
      security: [{ staffAuth: [] }],
      responses: {
        "201": { description: "Segment created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/segments/{id}": {
    get: {
      summary: "List customers in an analytics segment",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      ],
      responses: {
        "200": { description: "Segment customers" },
        "401": { description: "Not authenticated" },
        "403": { description: "Analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/ledger-certification": {
    get: {
      summary: "Generate a period-based ledger certification report",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "query",
          name: "from",
          required: false,
          schema: { type: "string", format: "date" },
          description: "Inclusive period start. Defaults to 30 days before the end date."
        },
        {
          in: "query",
          name: "to",
          required: false,
          schema: { type: "string", format: "date" },
          description: "Inclusive period end. Defaults to today."
        }
      ],
      responses: {
        "200": {
          description: "Certification summary and day-level value movement totals",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LedgerCertificationResponse" } }
          }
        },
        "400": { description: "Invalid date range" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and analytics feature required" }
      }
    }
  },
  "/api/v1/admin/analytics/ledger-certification.csv": {
    get: {
      summary: "Export the ledger certification report as CSV",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "query",
          name: "from",
          required: false,
          schema: { type: "string", format: "date" }
        },
        {
          in: "query",
          name: "to",
          required: false,
          schema: { type: "string", format: "date" }
        }
      ],
      responses: {
        "200": {
          description: "Ledger certification CSV export",
          content: {
            "text/csv": {
              schema: { type: "string" }
            }
          }
        },
        "400": { description: "Invalid date range" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role and analytics feature required" }
      }
    }
  }
};

function detectMountPrefix(layer) {
  const source = String(layer?.regexp || "");
  if (source.includes("\\/api\\/v1")) return "/api/v1";
  if (source.includes("\\/api\\/?")) return "/api";
  return "";
}

function normalizeExpressPath(routePath) {
  return String(routePath || "").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function inferSecurity(pathname) {
  if (
    pathname.startsWith("/api/v1/customer/")
    || pathname === "/api/v1/customer/me"
  ) return [{ customerAuth: [] }];

  if (
    pathname.startsWith("/api/v1/admin/")
    || (pathname.startsWith("/api/v1/staff/") && pathname !== "/api/v1/staff/login")
  ) return [{ staffAuth: [] }];

  if (pathname.startsWith("/api/v1/super/") && pathname !== "/api/v1/super/login") {
    return [{ superAuth: [] }];
  }

  return undefined;
}

function extractMiddlewareMeta(layer) {
  const handle = layer?.handle || layer;
  const name = String(layer?.name || handle?.name || "");
  const meta = clone(handle?.__openapi || {});

  if (name === "requireStaff") meta.auth = meta.auth || "staff";
  if (name === "requireCustomer") meta.auth = meta.auth || "customer";
  if (name === "requireSuperAdmin") meta.auth = meta.auth || "super";
  if (name === "requireOwner") {
    meta.auth = meta.auth || "staff";
    meta.staffRoles = [...new Set([...(meta.staffRoles || []), "OWNER"])];
  }
  if (name === "csrfProtect") meta.csrfRequired = true;
  if (name === "tenantContext") meta.tenantContext = true;

  return meta;
}

function collectRouteMiddlewareMeta(layers = []) {
  const auths = new Set();
  const roles = new Set();
  const permissions = new Set();
  const planFeatures = new Set();
  let csrfRequired = false;
  let tenantContext = false;

  for (const layer of layers) {
    const meta = extractMiddlewareMeta(layer);
    if (meta.auth) auths.add(meta.auth);
    for (const role of meta.staffRoles || []) roles.add(role);
    for (const permission of meta.staffPermissions || []) permissions.add(permission);
    for (const feature of meta.planFeatures || []) planFeatures.add(feature);
    if (meta.csrfRequired) csrfRequired = true;
    if (meta.tenantContext) tenantContext = true;
  }

  return {
    auths: [...auths],
    staffRoles: [...roles],
    staffPermissions: [...permissions],
    planFeatures: [...planFeatures],
    csrfRequired,
    tenantContext
  };
}

function inferSuccessStatus(method, pathname) {
  const createdPostRoutes = new Set([
    "/api/v1/admin/analytics/segments",
    "/api/v1/admin/achievements",
    "/api/v1/admin/challenges",
    "/api/v1/admin/gift-cards",
    "/api/v1/admin/tiers",
    "/api/v1/public/business/register",
    "/api/v1/super/businesses",
    "/api/v1/super/businesses/{businessId}/users"
  ]);
  if (method === "post" && pathname === "/api/v1/admin/analytics/calculate") return "202";
  if (method === "post" && createdPostRoutes.has(pathname)) return "201";
  if (method === "delete") return "200";
  return "200";
}

function buildDerivedSummary(method, pathname) {
  return `Derived ${method.toUpperCase()} ${pathname}`;
}

function buildDerivedOperation(method, pathname, routeMeta = null) {
  const operation = {
    summary: buildDerivedSummary(method, pathname),
    responses: {
      [inferSuccessStatus(method, pathname)]: {
        description: "Success"
      }
    }
  };

  const auth = routeMeta?.auths?.[0] || null;
  const security = auth === "customer"
    ? [{ customerAuth: [] }]
    : auth === "staff"
      ? [{ staffAuth: [] }]
      : auth === "super"
        ? [{ superAuth: [] }]
        : inferSecurity(pathname);
  if (security) operation.security = security;

  const params = Array.from(pathname.matchAll(/\{([^}]+)\}/g)).map((match) => ({
    in: "path",
    name: match[1],
    required: true,
    schema: { type: "string" }
  }));
  if (params.length) operation.parameters = params;

  if (routeMeta?.csrfRequired) operation["x-csrf-required"] = true;
  if (routeMeta?.tenantContext) operation["x-tenant-context"] = true;
  if (routeMeta?.staffRoles?.length) operation["x-required-roles"] = routeMeta.staffRoles;
  if (routeMeta?.staffPermissions?.length) operation["x-required-permissions"] = routeMeta.staffPermissions;
  if (routeMeta?.planFeatures?.length) operation["x-plan-features"] = routeMeta.planFeatures;

  return operation;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonSchemaTypeToOpenApiType(type) {
  if (Array.isArray(type)) {
    return type.find((entry) => entry !== "null") || "string";
  }
  return type || "string";
}

function buildQueryParametersFromComponent(name) {
  const schema = components[name];
  if (!schema || jsonSchemaTypeToOpenApiType(schema.type) !== "object") return [];

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties || {}).map(([paramName, paramSchema]) => ({
    in: "query",
    name: paramName,
    required: required.has(paramName),
    schema: clone(paramSchema)
  }));
}

function buildJsonContent(schemaName) {
  return {
    "application/json": {
      schema: schemaRef(schemaName)
    }
  };
}

function applyResponseSchemas(responses = {}, schemaBindings = {}) {
  const nextResponses = { ...responses };

  for (const [status, schemaName] of Object.entries(schemaBindings || {})) {
    nextResponses[status] = {
      ...(nextResponses[status] || {}),
      content: buildJsonContent(schemaName)
    };
  }

  for (const status of ["400", "401", "403", "404", "409", "422", "429", "500"]) {
    if (!nextResponses[status]) continue;
    if (nextResponses[status].content) continue;
    nextResponses[status] = {
      ...nextResponses[status],
      content: buildJsonContent("ErrorResponse")
    };
  }

  return nextResponses;
}

function applySchemaBindingsToOperation(operation, binding = {}) {
  const next = {
    ...operation,
    parameters: Array.isArray(operation.parameters) ? [...operation.parameters] : undefined,
    responses: { ...(operation.responses || {}) }
  };

  if (binding.body) {
    next.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: schemaRef(binding.body)
        }
      }
    };
  }

  if (binding.query) {
    const existing = Array.isArray(next.parameters) ? next.parameters : [];
    const queryParams = buildQueryParametersFromComponent(binding.query);
    next.parameters = [...existing, ...queryParams];
  }

  next.responses = applyResponseSchemas(next.responses, binding.responses);

  return next;
}

function collectVersionedRoutes(stack, prefix = "", paths = new Map(), inheritedLayers = []) {
  let activeInherited = [...inheritedLayers];

  for (const layer of stack || []) {
    if (layer.route?.path) {
      if (prefix !== "/api/v1") continue;
      const pathname = normalizeExpressPath(`${prefix}${layer.route.path}`);
      if (pathname.includes("/openapi.") || pathname.startsWith("/api/v1/docs")) continue;
      const pathItem = paths.get(pathname) || {};
      const routeMeta = collectRouteMiddlewareMeta([...activeInherited, ...(layer.route.stack || [])]);
      for (const method of Object.keys(layer.route.methods || {})) {
        pathItem[method] = applySchemaBindingsToOperation(
          buildDerivedOperation(method, pathname, routeMeta),
          routeSchemaBindings[pathname]?.[method]
        );
      }
      paths.set(pathname, pathItem);
      continue;
    }

    if (layer.name === "router" && layer.handle?.stack) {
      const nextPrefix = prefix || detectMountPrefix(layer);
      collectVersionedRoutes(layer.handle.stack, nextPrefix, paths, activeInherited);
      continue;
    }

    activeInherited = [...activeInherited, layer];
  }

  return paths;
}

async function deriveRoutePaths() {
  const { apiRoutes } = await import("../app/routes/index.js");
  const derivedEntries = Array.from(collectVersionedRoutes(apiRoutes.stack).entries())
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(derivedEntries);
}

function mergePaths(derivedPaths, overridePaths) {
  const merged = { ...derivedPaths };
  for (const [pathname, operations] of Object.entries(overridePaths)) {
    const existingPathItem = merged[pathname] || {};
    const nextPathItem = { ...existingPathItem };
    for (const [method, operation] of Object.entries(operations)) {
      const mergedOperation = {
        ...(existingPathItem[method] || {}),
        ...operation
      };
      if (existingPathItem[method]?.responses || operation.responses) {
        mergedOperation.responses = { ...(existingPathItem[method]?.responses || {}) };
        for (const [status, response] of Object.entries(operation.responses || {})) {
          mergedOperation.responses[status] = {
            ...(existingPathItem[method]?.responses?.[status] || {}),
            ...response
          };
        }
      }
      nextPathItem[method] = {
        ...mergedOperation,
        responses: applyResponseSchemas(mergedOperation.responses)
      };
    }
    merged[pathname] = nextPathItem;
  }

  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right))
  );
}

export async function buildOpenApiDoc() {
  const paths = mergePaths(await deriveRoutePaths(), curatedPaths);

  return {
    openapi: "3.0.3",
    info: {
      title: "PuntosFieles API",
      version: pkg.version,
      description: "Route-derived OpenAPI document for versioned /api/v1 routes, with curated request/response metadata layered onto the discovered route surface."
    },
    servers: [{ url: "https://api.puntos.local" }],
    paths,
    components: {
      securitySchemes: {
        staffAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_staff" },
        customerAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_customer" },
        superAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_super" }
      },
      schemas: components
    }
  };
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (!value.length) return '""';
    if (/^[A-Za-z0-9._/-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function toYaml(value, indent = 0) {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${space}[]`;
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (!entries.length) return `${space}- {}`;
          const [firstKey, firstValue] = entries[0];
          const firstScalar = firstValue === null || typeof firstValue !== "object";
          if (firstScalar) {
            const rest = entries.slice(1)
              .map(([key, nested]) => `${" ".repeat(indent + 2)}${key}:${
                nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 4)}` : ` ${yamlScalar(nested)}`
              }`)
              .join("\n");
            return `${space}- ${firstKey}: ${yamlScalar(firstValue)}${rest ? `\n${rest}` : ""}`;
          }
          return `${space}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}${
            entries.slice(1).length
              ? `\n${entries.slice(1).map(([key, nested]) => `${" ".repeat(indent + 2)}${key}:${
                nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 4)}` : ` ${yamlScalar(nested)}`
              }`).join("\n")}`
              : ""
          }`;
        }
        return `${space}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return `${space}{}`;
    return entries
      .map(([key, nested]) => `${space}${key}:${
        nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 2)}` : ` ${yamlScalar(nested)}`
      }`)
      .join("\n");
  }
  return `${space}${yamlScalar(value)}`;
}

export async function writeOpenApiFiles(doc) {
  const resolvedDoc = doc || await buildOpenApiDoc();
  const docsDir = path.join(process.cwd(), "docs");
  const jsonPath = path.join(docsDir, "openapi.json");
  const yamlPath = path.join(docsDir, "openapi.yaml");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(resolvedDoc, null, 2)}\n`);
  fs.writeFileSync(yamlPath, `${toYaml(resolvedDoc)}\n`);
  return { doc: resolvedDoc, jsonPath, yamlPath };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { jsonPath, yamlPath } = await writeOpenApiFiles();
  console.log(`OpenAPI spec written to ${jsonPath} and ${yamlPath}`);
}
