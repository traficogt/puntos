#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  awardPointsSchema,
  requestJoinCodeSchema,
  rewardCreateSchema,
  rewardUpdateSchema,
  staffLoginSchema,
  verifyJoinCodeSchema,
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
  OwnerProgressAcknowledgeSchema,
  OwnerProgressGoalSchema,
  OwnerProgressReviewSchema,
  OwnerProgressVisibilitySchema,
  OwnerProgressSettingsSchema,
} = await import("../app/services/owner-progress-service.js");
const { ProgramSchema, CampaignRulesSchema, ExternalAwardsSchema } =
  await import("../app/routes/admin/program-support.js");
const { StaffCreateSchema, StaffUpdateSchema } = await import("../app/routes/admin/staff.js");
const { WebhookSchema } = await import("../app/routes/admin/webhooks.js");
const { CohortRetentionQuerySchema, TopCustomersQuerySchema } =
  await import("../app/routes/analytics/cohorts.js");
const { FirstPurchaseReturnQuery } =
  await import("../app/routes/analytics/first-purchase-returns.js");
const { CreateSegmentSchema, SegmentCustomersQuerySchema } =
  await import("../app/routes/analytics/segments.js");
const { CreateGiftCardSchema, GiftCardListQuerySchema, RedeemGiftCardSchema } =
  await import("../app/routes/gift-card-routes.js");
const {
  AchievementCreateSchema,
  AchievementUpdateSchema,
  ChallengeCreateSchema,
  ChallengeUpdateSchema,
} = await import("../app/routes/gamification-support.js");
const { PaymentWebhookListQuerySchema, ResolveSchema } =
  await import("../app/routes/payment-webhook-routes.js");
const { ExternalAwardSchema } = await import("../app/routes/public-routes.js");
const { OrderCreateSchema } = await import("../app/routes/order-routes.js");
const { OrderReturnCreateSchema } = await import("../app/routes/order-return-routes.js");
const {
  PublicContactUpsertSchema,
  PublicContactLookupRequestSchema,
  PublicContactIdentifierLinkSchema,
  PublicContactIdentifierResolveSchema,
  PublicContactIdentifierUnlinkSchema,
} = await import("../app/routes/contact-sync-routes.js");
const {
  LoginSchema,
  UpdatePlanSchema,
  UpdatePlanFeaturesSchema,
  SetWalletBroadcastSchema,
  CreateBusinessSchema,
  CreateBusinessUserSchema,
} = await import("../app/routes/super-support.js");
const { RedeemSchema, RefundSchema, SyncSchema } = await import("../app/routes/staff-routes.js");
const { TierCreateSchema, TierUpdateSchema } = await import("../app/routes/tier-routes.js");
const { TrialRequestCodeSchema, TrialVerifySchema, TrialSignupSchema } =
  await import("../app/routes/public-trial-routes.js");
const { TrialExtendSchema, ManualActivateSchema } =
  await import("../app/routes/super-trial-routes.js");
const { BillingCatalogSchema } = await import("../app/services/billing-catalog-service.js");

const TimestampSchema = z.string();
const JsonRecordSchema = z.record(z.string(), z.any());

function okEnvelope(dataShape = {}) {
  return z.object({
    ok: z.literal(true),
    ...dataShape,
  });
}

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

const BranchResourceSchema = z
  .object({
    id: z.guid(),
    business_id: z.guid().optional(),
    name: z.string(),
    address: z.string().nullable().optional(),
    code: z.string(),
    created_at: TimestampSchema.optional(),
  })
  .passthrough();

const StaffResourceSchema = z
  .object({
    id: z.guid(),
    name: z.string(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    role: z.string(),
    branch_id: z.guid().nullable().optional(),
    active: z.boolean().optional(),
    can_manage_gift_cards: z.boolean().optional(),
    created_at: TimestampSchema.optional(),
  })
  .passthrough();

const WebhookEndpointResourceSchema = z
  .object({
    id: z.guid(),
    business_id: z.guid().optional(),
    url: z.string().url(),
    events: z.array(z.string()),
    active: z.boolean(),
    created_at: TimestampSchema.optional(),
    secret_masked: z.string().nullable().optional(),
    has_secret: z.boolean().optional(),
  })
  .passthrough();

const GiftCardResourceSchema = z
  .object({
    id: z.guid(),
    business_id: z.guid(),
    branch_id: z.guid().nullable().optional(),
    code: z.string(),
    qr_token: z.string().optional(),
    issued_to_name: z.string().nullable().optional(),
    issued_to_phone: z.string().nullable().optional(),
    initial_amount_q: z.union([z.number(), z.string()]),
    balance_q: z.union([z.number(), z.string()]),
    status: z.string(),
    expires_at: TimestampSchema.nullable().optional(),
    created_by: z.guid().nullable().optional(),
    created_at: TimestampSchema.optional(),
    updated_at: TimestampSchema.optional(),
  })
  .passthrough();

const GiftCardTransactionResourceSchema = z
  .object({
    id: z.guid(),
    gift_card_id: z.guid(),
    business_id: z.guid(),
    staff_user_id: z.guid().nullable().optional(),
    tx_type: z.string(),
    amount_q: z.union([z.number(), z.string()]),
    balance_after_q: z.union([z.number(), z.string()]),
    meta: JsonRecordSchema.optional(),
    created_at: TimestampSchema.optional(),
  })
  .passthrough();

const RewardResourceSchema = z
  .object({
    id: z.guid(),
    business_id: z.guid(),
    name: z.string(),
    description: z.string().nullable().optional(),
    points_cost: z.number(),
    active: z.boolean(),
    stock: z.number().nullable().optional(),
    valid_until: TimestampSchema.nullable().optional(),
    created_at: TimestampSchema.optional(),
    branch_ids: z.array(z.guid()).optional(),
  })
  .passthrough();

const PaymentWebhookEventResourceSchema = z
  .object({
    id: z.guid(),
    provider: z.string(),
    provider_event_id: z.string(),
    event_type: z.string().nullable().optional(),
    business_slug: z.string().nullable().optional(),
    business_id: z.guid().nullable().optional(),
    customer_id: z.guid().nullable().optional(),
    customer_phone: z.string().nullable().optional(),
    amount_q: z.union([z.number(), z.string()]),
    currency: z.string().nullable().optional(),
    status: z.string(),
    reason: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    linked_transaction_id: z.guid().nullable().optional(),
    created_at: TimestampSchema.optional(),
    updated_at: TimestampSchema.optional(),
  })
  .passthrough();

const PaymentWebhookResolveResponseSchema = okEnvelope({
  event: PaymentWebhookEventResourceSchema.optional(),
  transaction: JsonRecordSchema.optional(),
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
  replay_events: z.number(),
});

const LedgerCertificationResponseSchema = okEnvelope({
  business: z.object({
    id: z.guid(),
    name: z.string(),
    slug: z.string(),
  }),
  generated_at: TimestampSchema,
  period: z.object({
    from: z.string(),
    to: z.string(),
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
    latest_reconciliation_completed_at: TimestampSchema.nullable(),
  }),
  daily_rows: z.array(LedgerCertificationDailyRowSchema),
}).passthrough();

const StaffAwardResponseSchema = okEnvelope({
  pointsAwarded: z.number(),
  newBalance: z.number(),
  newPendingBalance: z.number().optional(),
  customerId: z.guid(),
  transactionId: z.guid(),
  status: z.string().optional(),
  availableAt: TimestampSchema.nullable().optional(),
}).passthrough();

const StaffRefundResponseSchema = okEnvelope({
  transactionId: z.guid(),
  reversalTransactionId: z.guid(),
  customerId: z.guid(),
  pointsEffect: z.number(),
  gamificationReconciliation: z.object({
    achievementsRevoked: z.number(),
    challengesRevoked: z.number(),
  }),
  newBalance: z.number(),
  newPendingBalance: z.number(),
}).passthrough();

const OrderCreateResponseSchema = okEnvelope({
  orderId: z.guid(),
  transactionId: z.guid(),
  customerId: z.guid(),
  pointsAwarded: z.number(),
  status: z.string(),
  replay: z.boolean().optional(),
}).passthrough();

const OrderReturnCreateResponseSchema = okEnvelope({
  orderReturnId: z.guid(),
  orderId: z.guid(),
  customerId: z.guid(),
  outcome: z.enum(["PENDING_CANCELLED", "POSTED_REVERSED"]),
  pointsEffect: z.number(),
  reversalTransactionId: z.guid().nullable().optional(),
  replay: z.boolean().optional(),
}).passthrough();

const ContactResourceSchema = z
  .object({
    id: z.string(),
    business_id: z.string(),
    phone: z.string(),
    name: z.string().nullable().optional(),
    points: z.union([z.number(), z.string()]).optional(),
    pending_points: z.union([z.number(), z.string()]).optional(),
    lifetime_points: z.union([z.number(), z.string()]).optional(),
    tier: z.string().nullable().optional(),
    created_at: TimestampSchema.optional(),
    last_visit_at: TimestampSchema.nullable().optional(),
  })
  .passthrough();

const ContactIdentifierResourceSchema = z
  .object({
    id: z.string(),
    business_id: z.string(),
    customer_id: z.string(),
    identifier_type: z.string(),
    identifier_value: z.string(),
    label: z.string().nullable().optional(),
    active: z.boolean(),
    meta: JsonRecordSchema.optional(),
    created_at: TimestampSchema.optional(),
    updated_at: TimestampSchema.optional(),
  })
  .passthrough();

const PublicContactResponseSchema = okEnvelope({
  contact: ContactResourceSchema,
  identifiers: z.array(ContactIdentifierResourceSchema),
}).passthrough();

const PublicContactIdentifierLinkResponseSchema = okEnvelope({
  identifier: ContactIdentifierResourceSchema,
}).passthrough();

const PublicContactIdentifierResolveResponseSchema = okEnvelope({
  contact: ContactResourceSchema,
}).passthrough();

const PublicContactIdentifierUnlinkResponseSchema = okEnvelope({
  identifier: ContactIdentifierResourceSchema,
}).passthrough();

const TrialStatusSchema = z.enum(["active", "expiring", "locked", "converted", "none"]);
const OwnerBillingStateSchema = z.object({
  status: z.string(),
  currency: z.string().nullable(),
  provider: z.string().nullable(),
  subscription: z
    .object({
      plan: z.string(),
      quantity: z.number().int(),
      currency: z.string(),
      unit_amount_minor: z.number().int(),
      status: z.string(),
      current_period_end: TimestampSchema.nullable(),
      cancel_at: TimestampSchema.nullable(),
    })
    .nullable(),
  purge_after: TimestampSchema.nullable(),
});
const PublicTrialSignupResponseSchema = okEnvelope({
  business: z.object({
    id: z.guid(),
    slug: z.string(),
    name: z.string(),
    plan: z.string(),
    plan_name: z.string(),
  }),
  trial: z.object({
    status: TrialStatusSchema,
    days_left: z.number().int().nullable(),
    started_at: TimestampSchema.nullable(),
    ends_at: TimestampSchema.nullable(),
  }),
  intended_plan: z.string().nullable(),
  join_url: z.string(),
  next_url: z.string(),
});
const AdminTrialResponseSchema = okEnvelope({
  trial: z
    .object({
      status: TrialStatusSchema,
      days_left: z.number().int().nullable(),
      started_at: TimestampSchema.nullable(),
      ends_at: TimestampSchema.nullable(),
      ends_on: z.string().nullable(),
      locked_at: TimestampSchema.nullable(),
      purge_after: TimestampSchema.nullable(),
      purge_on: z.string().nullable(),
      plan: z.string(),
      plan_name: z.string(),
      upgrade_url: z.string(),
      upgrade_available: z.boolean(),
      copy: z.record(z.string(), z.any()),
    })
    .passthrough(),
  billing: OwnerBillingStateSchema,
});
const PublicPlansResponseSchema = okEnvelope({
  pricing_status: z.literal("published"),
  comparison_currency: z.literal("USD"),
  pricing_unit: z.literal("branch_month"),
  published_at: z.string(),
  reference_gtq: z.object({ rate: z.number(), as_of: z.string() }).nullable(),
  trial: z.object({
    days: z.number().int(),
    plan: z.string(),
    plan_name: z.string(),
    requires_card: z.boolean(),
    url: z.string(),
  }),
  plans: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        pricing: z.object({
          currency: z.literal("USD"),
          per: z.literal("branch_month"),
          monthly: z.number(),
          reference_gtq_monthly: z.number().nullable(),
        }),
        limits: z.object({
          activeCustomers: z.number(),
          branches: z.number(),
          rewards: z.number(),
        }),
        features: z.record(z.string(), z.boolean()),
        feature_list: z.array(z.string()),
        cta: z.object({ trial_url: z.string(), trial_label: z.string(), contact_url: z.string() }),
      })
      .passthrough(),
  ),
});
const TrialLockedErrorSchema = z.object({
  error: z.string(),
  code: z.literal("TRIAL_LOCKED"),
  trial_status: z.literal("locked"),
  trial_ends_at: TimestampSchema.nullable(),
  purge_after: TimestampSchema.nullable(),
  upgrade_url: z.string(),
});

const schemas = {
  PublicTrialRequestCodeRequest: TrialRequestCodeSchema,
  PublicTrialVerifyRequest: TrialVerifySchema,
  PublicTrialSignupRequest: TrialSignupSchema,
  PublicTrialSignupResponse: PublicTrialSignupResponseSchema,
  PublicPlansResponse: PublicPlansResponseSchema,
  AdminTrialResponse: AdminTrialResponseSchema,
  TrialLockedError: TrialLockedErrorSchema,
  SuperTrialExtendRequest: TrialExtendSchema,
  SuperManualActivateRequest: ManualActivateSchema,
  SuperBillingCatalogRequest: BillingCatalogSchema,
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
  SuperWalletBroadcastRequest: SetWalletBroadcastSchema,
  SuperCreateBusinessRequest: CreateBusinessSchema,
  SuperCreateBusinessUserRequest: CreateBusinessUserSchema,
  BusinessPublicResponse: z.object({
    id: z.guid(),
    name: z.string(),
    slug: z.string(),
    category: z.string().nullable().optional(),
    program_type: z.enum(["SPEND", "VISIT", "ITEM"]),
  }),
  CustomerProfileResponse: z.object({
    ok: z.literal(true),
    business: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
    }),
    customer: z.object({
      id: z.string(),
      phone: z.string(),
      name: z.string().nullable(),
      points: z.number(),
      pending_points: z.number(),
      lifetime_points: z.number(),
      created_at: z.string(),
      last_visit_at: z.string().nullable(),
    }),
  }),
  ReferralCodeResponse: z.object({
    ok: z.literal(true),
    referral_code: z.string(),
  }),
  TierInfoResponse: z.object({
    ok: z.literal(true),
    tier: z.record(z.string(), z.any()),
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
  OwnerProgressAcknowledgeRequest: OwnerProgressAcknowledgeSchema,
  OwnerProgressGoalRequest: OwnerProgressGoalSchema,
  OwnerProgressReviewRequest: OwnerProgressReviewSchema,
  OwnerProgressVisibilityRequest: OwnerProgressVisibilitySchema,
  OwnerProgressSettingsRequest: OwnerProgressSettingsSchema,
  OrderCreateRequest: OrderCreateSchema,
  OrderReturnCreateRequest: OrderReturnCreateSchema,
  PublicContactUpsertRequest: PublicContactUpsertSchema,
  PublicContactLookupRequest: PublicContactLookupRequestSchema,
  PublicContactIdentifierLinkRequest: PublicContactIdentifierLinkSchema,
  PublicContactIdentifierResolveRequest: PublicContactIdentifierResolveSchema,
  PublicContactIdentifierUnlinkRequest: PublicContactIdentifierUnlinkSchema,
  GiftCardListQuery: GiftCardListQuerySchema,
  AnalyticsSegmentCustomersQuery: SegmentCustomersQuerySchema,
  AnalyticsCohortsQuery: CohortRetentionQuerySchema,
  FirstPurchaseReturnQuery,
  FirstPurchaseReturnResponse: okEnvelope({
    generated_at: TimestampSchema,
    timezone: z.string(),
    scope: z.object({
      branch_id: z.guid().nullable(),
      first_purchase_scope: z.literal("business"),
      return_scope: z.literal("business"),
    }),
    available_weeks: z.array(z.string().date()),
    cohort: z.object({
      week_start: z.string().date(),
      week_end: z.string().date(),
      start: TimestampSchema,
      end: TimestampSchema,
      customers: z.number().int().nonnegative(),
      legacy_timestamp_customers: z.number().int().nonnegative(),
    }),
    follow_up: z.object({
      days: z.literal(30),
      definition: z.literal("later_local_day_within_720_hours"),
    }),
    completed: z.object({
      customers: z.number().int().nonnegative(),
      returned_customers: z.number().int().nonnegative(),
      without_return_customers: z.number().int().nonnegative(),
      return_rate_pct: z.number().min(0).max(100).nullable(),
    }),
    ongoing: z.object({
      customers: z.number().int().nonnegative(),
      returned_customers: z.number().int().nonnegative(),
    }),
    data_readiness: z
      .object({ state: z.string(), inactivity_allowed: z.boolean(), summary: z.string() })
      .passthrough(),
    notes: z.array(z.string()),
  }),
  AnalyticsTopCustomersQuery: TopCustomersQuerySchema,
  PaymentWebhookListQuery: PaymentWebhookListQuerySchema,
  ErrorResponse: ErrorResponseSchema,
  LedgerCertificationResponse: LedgerCertificationResponseSchema,
  BranchResource: BranchResourceSchema,
  BranchListResponse: okEnvelope({
    branches: z.array(BranchResourceSchema),
  }),
  BranchDetailResponse: okEnvelope({
    branch: BranchResourceSchema,
  }),
  StaffResource: StaffResourceSchema,
  StaffListResponse: okEnvelope({
    staff: z.array(StaffResourceSchema),
  }),
  StaffDetailResponse: okEnvelope({
    staff: StaffResourceSchema,
  }),
  WebhookEndpointResource: WebhookEndpointResourceSchema,
  WebhookListResponse: okEnvelope({
    endpoints: z.array(WebhookEndpointResourceSchema),
  }),
  WebhookDetailResponse: okEnvelope({
    endpoint: WebhookEndpointResourceSchema,
  }),
  RewardListResponse: okEnvelope({
    rewards: z.array(RewardResourceSchema),
  }),
  RewardDetailResponse: okEnvelope({
    reward: RewardResourceSchema,
  }),
  GiftCardResource: GiftCardResourceSchema,
  GiftCardTransactionResource: GiftCardTransactionResourceSchema,
  GiftCardListResponse: okEnvelope({
    gift_cards: z.array(GiftCardResourceSchema),
  }),
  GiftCardDetailResponse: okEnvelope({
    gift_card: GiftCardResourceSchema,
  }),
  GiftCardLookupResponse: okEnvelope({
    card: GiftCardResourceSchema,
    transactions: z.array(GiftCardTransactionResourceSchema),
  }),
  PaymentWebhookEventResource: PaymentWebhookEventResourceSchema,
  PaymentWebhookListResponse: okEnvelope({
    events: z.array(PaymentWebhookEventResourceSchema),
  }),
  PaymentWebhookResolveResponse: PaymentWebhookResolveResponseSchema,
  AnalyticsSegmentCustomersResponse: okEnvelope({
    customers: z.array(JsonRecordSchema),
    limit: z.number(),
    offset: z.number(),
  }),
  StaffAwardResponse: StaffAwardResponseSchema,
  StaffRefundResponse: StaffRefundResponseSchema,
  OrderCreateResponse: OrderCreateResponseSchema,
  OrderReturnCreateResponse: OrderReturnCreateResponseSchema,
  ContactResource: ContactResourceSchema,
  ContactIdentifierResource: ContactIdentifierResourceSchema,
  PublicContactResponse: PublicContactResponseSchema,
  PublicContactIdentifierLinkResponse: PublicContactIdentifierLinkResponseSchema,
  PublicContactIdentifierResolveResponse: PublicContactIdentifierResolveResponseSchema,
  PublicContactIdentifierUnlinkResponse: PublicContactIdentifierUnlinkResponseSchema,
};

/** @typedef {import("../types/auth.js").OpenApiMiddlewareMeta} OpenApiMiddlewareMeta */
/**
 * A JSON Schema (as emitted by zod, or a `$ref`) in the parts this generator
 * and its contract test read.
 * @typedef {{
 *   type?: string | string[],
 *   required?: string[],
 *   properties?: Record<string, JsonSchema>,
 *   items?: JsonSchema,
 *   additionalProperties?: boolean | JsonSchema,
 *   enum?: unknown[],
 *   default?: unknown,
 *   minimum?: number,
 *   maximum?: number,
 *   $ref?: string,
 *   [key: string]: unknown,
 * }} JsonSchema
 */
/**
 * An OpenAPI parameter object.
 * @typedef {{ in: string, name: string, required?: boolean, schema?: JsonSchema, [key: string]: unknown }} OpenApiParameter
 */
/**
 * An OpenAPI response object.
 * @typedef {{ description?: string, content?: Record<string, { schema: JsonSchema }>, [key: string]: unknown }} OpenApiResponse
 */
/**
 * An OpenAPI operation object with the vendor extensions this project emits.
 * @typedef {{
 *   summary?: string,
 *   responses?: Record<string, OpenApiResponse>,
 *   parameters?: OpenApiParameter[],
 *   security?: Array<Record<string, string[]>>,
 *   requestBody?: { required?: boolean, content: Record<string, { schema: JsonSchema }> },
 *   "x-csrf-required"?: boolean,
 *   "x-tenant-context"?: boolean,
 *   "x-required-roles"?: string[],
 *   "x-required-permissions"?: string[],
 *   "x-plan-features"?: string[],
 *   [key: string]: unknown,
 * }} OpenApiOperation
 */
/**
 * Schema bindings for one route: request body / query component names and
 * response component names by status.
 * @typedef {{ body?: string, query?: string, responses?: Record<string, string> }} RouteSchemaBinding
 */
/**
 * An Express router stack entry (or the handler it wraps) as this generator
 * walks it. Express does not type its internal layers.
 * @typedef {object} RouterLayer
 * @property {string} [name]
 * @property {RouterLayer | RouterHandle | null} [handle]
 * @property {OpenApiMiddlewareMeta} [__openapi]
 * @property {RouterLayer[]} [stack]
 * @property {{ path?: string, stack?: RouterLayer[], methods?: Record<string, boolean> } | null} [route]
 */

/**
 * A layer's handler as Express stores it: the middleware or route function,
 * possibly annotated with `__openapi`, or a nested router carrying its own
 * `stack`.
 * @typedef {((...args: never[]) => unknown) & { __openapi?: OpenApiMiddlewareMeta, stack?: RouterLayer[] }} RouterHandle
 */

/**
 * @param {import("zod").ZodType} schema
 * @returns {JsonSchema}
 */
function toComponentSchema(schema) {
  // zod's JSON Schema type admits boolean sub-schemas (`true`/`false`), which the
  // object schemas this generator emits never contain.
  return /** @type {JsonSchema} */ (
    z.toJSONSchema(schema, {
      target: "openapi-3.0",
      io: "input",
      reused: "inline",
      cycles: "throw",
      override: ({ zodSchema, jsonSchema }) => {
        // Retain the documented stripped-object shape while defaults and
        // transformations describe what callers send rather than parsed output.
        if (zodSchema._zod.def.type === "object" && jsonSchema.additionalProperties === undefined) {
          jsonSchema.additionalProperties = false;
        }
      },
    })
  );
}

/** @type {Record<string, JsonSchema>} */
const components = {};
for (const [name, schema] of Object.entries(schemas)) {
  components[name] = toComponentSchema(schema);
}

/** @param {string} name a component schema name */
function schemaRef(name) {
  return { $ref: `#/components/schemas/${name}` };
}

/** @type {Record<string, Record<string, RouteSchemaBinding>>} path -> method -> bindings */
const routeSchemaBindings = {
  "/api/v1/staff/login": {
    post: { body: "StaffLoginRequest" },
  },
  "/api/v1/staff/award": {
    post: {
      body: "AwardPointsRequest",
      responses: { 200: "StaffAwardResponse" },
    },
  },
  "/api/v1/staff/redeem": {
    post: { body: "StaffRedeemRequest" },
  },
  "/api/v1/staff/sync": {
    post: { body: "StaffSyncAwardsRequest" },
  },
  "/api/v1/staff/refund": {
    post: {
      body: "StaffRefundRequest",
      responses: { 200: "StaffRefundResponse" },
    },
  },
  "/api/v1/public/business/{slug}/join/request-code": {
    post: { body: "RequestJoinCodeRequest" },
  },
  "/api/v1/public/business/{slug}/join/verify": {
    post: { body: "VerifyJoinCodeRequest" },
  },
  "/api/v1/public/external/award": {
    post: { body: "PublicExternalAwardRequest" },
  },
  "/api/v1/public/orders": {
    post: {
      body: "OrderCreateRequest",
      responses: { 200: "OrderCreateResponse" },
    },
  },
  "/api/v1/public/order-returns": {
    post: {
      body: "OrderReturnCreateRequest",
      responses: { 200: "OrderReturnCreateResponse" },
    },
  },
  "/api/v1/public/contacts": {
    post: {
      body: "PublicContactUpsertRequest",
      responses: { 200: "PublicContactResponse" },
    },
  },
  "/api/v1/public/contacts/lookup": {
    post: {
      body: "PublicContactLookupRequest",
      responses: { 200: "PublicContactResponse" },
    },
  },
  "/api/v1/public/contact-identifiers": {
    post: {
      body: "PublicContactIdentifierLinkRequest",
      responses: { 200: "PublicContactIdentifierLinkResponse" },
    },
  },
  "/api/v1/public/contact-identifiers/resolve": {
    post: {
      body: "PublicContactIdentifierResolveRequest",
      responses: { 200: "PublicContactIdentifierResolveResponse" },
    },
  },
  "/api/v1/public/contact-identifiers/unlink": {
    post: {
      body: "PublicContactIdentifierUnlinkRequest",
      responses: { 200: "PublicContactIdentifierUnlinkResponse" },
    },
  },
  "/api/v1/super/login": {
    post: { body: "SuperLoginRequest" },
  },
  "/api/v1/super/plans/{plan}/features": {
    put: { body: "SuperPlanFeaturesRequest" },
  },
  "/api/v1/public/plans": {
    get: { responses: { 200: "PublicPlansResponse" } },
  },
  "/api/v1/public/trial/request-code": {
    post: { body: "PublicTrialRequestCodeRequest" },
  },
  "/api/v1/public/trial/verify": {
    post: { body: "PublicTrialVerifyRequest" },
  },
  "/api/v1/public/trial/signup": {
    post: { body: "PublicTrialSignupRequest", responses: { 201: "PublicTrialSignupResponse" } },
  },
  "/api/v1/admin/trial": {
    get: { responses: { 200: "AdminTrialResponse" } },
  },
  "/api/v1/super/businesses/{businessId}/trial/extend": {
    post: { body: "SuperTrialExtendRequest" },
  },
  "/api/v1/super/businesses/{businessId}/billing/manual-activate": {
    post: { body: "SuperManualActivateRequest" },
  },
  "/api/v1/super/billing/catalog": {
    put: { body: "SuperBillingCatalogRequest" },
  },
  "/api/v1/super/businesses": {
    post: { body: "SuperCreateBusinessRequest" },
  },
  "/api/v1/super/businesses/{businessId}/plan": {
    put: { body: "SuperPlanUpdateRequest" },
  },
  "/api/v1/super/businesses/{businessId}/wallet-broadcast": {
    put: { body: "SuperWalletBroadcastRequest" },
  },
  "/api/v1/super/businesses/{businessId}/users": {
    post: { body: "SuperCreateBusinessUserRequest" },
  },
  "/api/v1/admin/tiers": {
    post: { body: "TierCreateRequest" },
  },
  "/api/v1/admin/tiers/{id}": {
    put: { body: "TierUpdateRequest" },
  },
  "/api/v1/admin/rewards": {
    get: { responses: { 200: "RewardListResponse" } },
    post: {
      body: "RewardCreateRequest",
      responses: { 200: "RewardDetailResponse" },
    },
  },
  "/api/v1/admin/rewards/{id}": {
    patch: {
      body: "RewardUpdateRequest",
      responses: { 200: "RewardDetailResponse" },
    },
  },
  "/api/v1/admin/branches": {
    get: { responses: { 200: "BranchListResponse" } },
    post: {
      body: "BranchCreateRequest",
      responses: { 200: "BranchDetailResponse" },
    },
  },
  "/api/v1/admin/staff": {
    get: { responses: { 200: "StaffListResponse" } },
    post: {
      body: "StaffCreateRequest",
      responses: { 200: "StaffDetailResponse" },
    },
  },
  "/api/v1/admin/staff/{id}": {
    patch: {
      body: "StaffUpdateRequest",
      responses: { 200: "StaffDetailResponse" },
    },
  },
  "/api/v1/admin/webhooks": {
    get: { responses: { 200: "WebhookListResponse" } },
    post: {
      body: "WebhookCreateRequest",
      responses: { 200: "WebhookDetailResponse" },
    },
  },
  "/api/v1/admin/gift-cards": {
    get: {
      query: "GiftCardListQuery",
      responses: { 200: "GiftCardListResponse" },
    },
    post: {
      body: "GiftCardCreateRequest",
      responses: { 201: "GiftCardDetailResponse" },
    },
  },
  "/api/v1/staff/gift-cards/redeem": {
    post: {
      body: "GiftCardRedeemRequest",
      responses: { 200: "GiftCardDetailResponse" },
    },
  },
  "/api/v1/staff/gift-cards/{codeOrToken}": {
    get: { responses: { 200: "GiftCardLookupResponse" } },
  },
  "/api/v1/admin/achievements": {
    post: { body: "AchievementCreateRequest" },
  },
  "/api/v1/admin/achievements/{id}": {
    patch: { body: "AchievementUpdateRequest" },
  },
  "/api/v1/admin/challenges": {
    post: { body: "ChallengeCreateRequest" },
  },
  "/api/v1/admin/challenges/{id}": {
    patch: { body: "ChallengeUpdateRequest" },
  },
  "/api/v1/admin/program": {
    put: { body: "ProgramUpdateRequest" },
  },
  "/api/v1/admin/program/campaign-rules": {
    put: { body: "CampaignRulesRequest" },
  },
  "/api/v1/admin/program/external-awards": {
    put: { body: "ExternalAwardsRequest" },
  },
  "/api/v1/admin/owner-progress/acknowledge": {
    post: { body: "OwnerProgressAcknowledgeRequest" },
  },
  "/api/v1/admin/owner-progress/goal": {
    post: { body: "OwnerProgressGoalRequest" },
  },
  "/api/v1/admin/owner-progress/review": {
    post: { body: "OwnerProgressReviewRequest" },
  },
  "/api/v1/admin/owner-progress/visibility": {
    post: { body: "OwnerProgressVisibilityRequest" },
  },
  "/api/v1/super/platform-settings/owner-progress": {
    put: { body: "OwnerProgressSettingsRequest" },
  },
  "/api/v1/admin/analytics/cohorts": {
    get: { query: "AnalyticsCohortsQuery" },
  },
  "/api/v1/admin/analytics/first-purchase-returns": {
    get: { query: "FirstPurchaseReturnQuery", responses: { 200: "FirstPurchaseReturnResponse" } },
  },
  "/api/v1/admin/analytics/top-customers": {
    get: { query: "AnalyticsTopCustomersQuery" },
  },
  "/api/v1/admin/analytics/segments": {
    post: { body: "AnalyticsSegmentCreateRequest" },
  },
  "/api/v1/admin/analytics/segments/{id}": {
    get: {
      query: "AnalyticsSegmentCustomersQuery",
      responses: { 200: "AnalyticsSegmentCustomersResponse" },
    },
  },
  "/api/v1/admin/payment-webhooks": {
    get: {
      query: "PaymentWebhookListQuery",
      responses: { 200: "PaymentWebhookListResponse" },
    },
  },
  "/api/v1/admin/payment-webhooks/{id}/resolve": {
    post: {
      body: "PaymentWebhookResolveRequest",
      responses: { 200: "PaymentWebhookResolveResponse" },
    },
  },
  "/api/v1/admin/analytics/ledger-certification": {
    get: {
      responses: { 200: "LedgerCertificationResponse" },
    },
  },
};

const publicHmacHeaderParameter = {
  in: "header",
  name: "x-signature",
  required: true,
  schema: { type: "string" },
  description: "Hex HMAC-SHA256 signature for the exact raw request body bytes.",
};

const trialLockedResponse = {
  description:
    "Trial locked: the business is past its trial end without a plan. Reads keep working; every staff mutation answers this body (code TRIAL_LOCKED).",
  content: { "application/json": { schema: { $ref: "#/components/schemas/TrialLockedError" } } },
};

const curatedPaths = {
  "/api/v1/public/plans": {
    get: {
      summary:
        "Published plan catalog: USD prices per branch per month, caps, features and the trial",
      responses: { 200: { description: "Catalog as /precios renders it" } },
    },
  },
  "/api/v1/public/trial/config": {
    get: {
      summary:
        "Self-serve trial configuration for the /prueba/ page (Turnstile site key, trial terms)",
      responses: { 200: { description: "Trial configuration" } },
    },
  },
  "/api/v1/public/trial/request-code": {
    post: {
      summary:
        "Send the owner's phone verification code for a self-serve trial (Turnstile required)",
      responses: {
        200: { description: "Code sent (dev_code only with the development provider)" },
        400: { description: "Validation error, Turnstile failed or dial code not allowed" },
        429: { description: "Rate limited (per IP and per phone)" },
        503: { description: "Signup unavailable or daily SMS cap reached" },
      },
    },
  },
  "/api/v1/public/trial/verify": {
    post: {
      summary: "Verify the phone code and receive a single-use 5-minute signup grant",
      responses: {
        200: { description: "Grant issued" },
        401: { description: "Code invalid or expired" },
        409: { description: "A trial already exists for this phone" },
      },
    },
  },
  "/api/v1/public/trial/signup": {
    post: {
      summary:
        "Create the trial business on Conecta (14 days, no card); sets the owner session cookie",
      responses: {
        201: { description: "Business created; cookie __Host-pf_staff is set" },
        400: { description: "Validation error or Turnstile failed" },
        401: { description: "Grant invalid or expired" },
        409: { description: "Email or phone already registered" },
      },
    },
  },
  "/api/v1/admin/trial": {
    get: {
      summary: "Trial and billing state for the owner app banner and lock screen",
      security: [{ staffAuth: [] }],
      responses: { 200: { description: "Trial state" }, 401: { description: "Not authenticated" } },
    },
  },
  "/api/v1/super/trials": {
    get: {
      summary: "List trials with status, days left, phone verification and activation facts",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "query",
          name: "status",
          required: false,
          schema: {
            type: "string",
            enum: ["all", "trialing", "expiring", "locked", "converted", "purge"],
          },
        },
        { in: "query", name: "limit", required: false, schema: { type: "integer" } },
      ],
      responses: { 200: { description: "Trial listing" } },
    },
  },
  "/api/v1/super/trials/summary": {
    get: {
      summary: "Weekly trial cohorts (starts, activated, converted, locked, purge candidates)",
      security: [{ superAuth: [] }],
      responses: { 200: { description: "Cohort table" } },
    },
  },
  "/api/v1/super/trials/purge-candidates": {
    get: {
      summary:
        "Dry-run purge report: locked businesses past retention and the rows a purge would remove",
      security: [{ superAuth: [] }],
      responses: { 200: { description: "Dry-run report; nothing is deleted" } },
    },
  },
  "/api/v1/super/businesses/{businessId}/trial/extend": {
    post: {
      summary: "Extend (or re-open) a trial by N days",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Trial extended" },
        404: { description: "Business not found" },
        409: { description: "Not a trial" },
      },
    },
  },
  "/api/v1/super/businesses/{businessId}/trial/lock": {
    post: {
      summary: "Lock a trialing business now",
      security: [{ superAuth: [] }],
      responses: { 200: { description: "Locked" }, 409: { description: "Not trialing" } },
    },
  },
  "/api/v1/super/businesses/{businessId}/billing/manual-activate": {
    post: {
      summary: "Activate a paid plan by hand (provider manual) and record who did it",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Plan active" },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/super/billing/catalog": {
    get: {
      summary: "Published prices and provider price ids (platform setting billing_catalog)",
      security: [{ superAuth: [] }],
      responses: { 200: { description: "Catalog" } },
    },
    put: {
      summary: "Replace the billing catalog",
      security: [{ superAuth: [] }],
      responses: { 200: { description: "Catalog saved" }, 400: { description: "Payload invalid" } },
    },
  },
  "/api/v1/health": {
    get: {
      summary: "Service health probe",
      responses: {
        200: { description: "Service healthy" },
        503: { description: "Service unhealthy" },
      },
    },
  },
  "/api/v1/ready": {
    get: {
      summary: "Readiness probe",
      responses: {
        200: { description: "Ready for traffic" },
        503: { description: "Not ready" },
      },
    },
  },
  "/api/v1/live": {
    get: {
      summary: "Liveness probe",
      responses: {
        200: { description: "Process is alive" },
      },
    },
  },
  "/api/v1/info": {
    get: {
      summary: "Service metadata",
      responses: {
        200: { description: "Version and runtime info" },
      },
    },
  },
  "/api/v1/staff/login": {
    post: {
      summary: "Staff login",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/StaffLoginRequest" } },
        },
      },
      responses: {
        200: { description: "Authenticated; cookie __Host-pf_staff is set" },
        400: { description: "Validation error" },
        401: { description: "Invalid credentials" },
      },
    },
  },
  "/api/v1/super/login": {
    post: {
      summary: "Super admin login",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperLoginRequest" } },
        },
      },
      responses: {
        200: { description: "Authenticated; cookie __Host-pf_super is set" },
        400: { description: "Validation error" },
        401: { description: "Invalid credentials" },
        403: { description: "Super admin not configured" },
      },
    },
  },
  "/api/v1/super/me": {
    get: {
      summary: "Current super admin session",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Current super admin session" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/staff/me": {
    get: {
      summary: "Current staff session",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Current staff session" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/staff/award": {
    post: {
      summary: "Award points to a customer",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AwardPointsRequest" } },
        },
      },
      responses: {
        200: { description: "Points awarded" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        402: trialLockedResponse,
        403: { description: "Permission denied" },
      },
    },
  },
  "/api/v1/public/business/{slug}": {
    get: {
      summary: "Get a business public profile by slug",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Business public profile",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/BusinessPublicResponse" } },
          },
        },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/public/business/{slug}/join/request-code": {
    post: {
      summary: "Request a customer join verification code",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/RequestJoinCodeRequest" } },
        },
      },
      responses: {
        200: { description: "Verification code requested" },
        400: { description: "Validation error" },
        404: { description: "Business not found" },
        429: { description: "Rate limited" },
      },
    },
  },
  "/api/v1/public/business/{slug}/join/verify": {
    post: {
      summary: "Verify a join code and create/login the customer",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/VerifyJoinCodeRequest" } },
        },
      },
      responses: {
        200: { description: "Customer authenticated; cookie __Host-pf_customer is set" },
        400: { description: "Validation error" },
        404: { description: "Business not found" },
        429: { description: "Rate limited" },
      },
    },
  },
  "/api/v1/public/customer/qr.svg": {
    get: {
      summary: "Get a short-lived customer QR as SVG",
      security: [{ customerAuth: [] }],
      responses: {
        200: {
          description: "SVG QR image with X-QR-Exp and X-QR-JTI headers",
          content: {
            "image/svg+xml": {
              schema: { type: "string" },
            },
          },
        },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/public/orders": {
    post: {
      summary: "Create and process an external order",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/OrderCreateRequest" } },
        },
      },
      responses: {
        200: {
          description: "Order processed or replayed",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/OrderCreateResponse" } },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or customer not found" },
        409: { description: "externalOrderId already used for different payload" },
      },
    },
  },
  "/api/v1/public/order-returns": {
    post: {
      summary: "Create and process an external order return",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/OrderReturnCreateRequest" } },
        },
      },
      responses: {
        200: {
          description: "Order return processed or replayed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OrderReturnCreateResponse" },
            },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or original order not found" },
        409: {
          description:
            "Return replay conflict, already-returned order, or manual handling required",
        },
      },
    },
  },
  "/api/v1/public/contacts": {
    post: {
      summary: "Create or update a scoped contact via public integration",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicContactUpsertRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Contact synced successfully",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PublicContactResponse" } },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or customer not found" },
        409: { description: "Contact data conflicts with an existing scoped customer" },
      },
    },
  },
  "/api/v1/public/contacts/lookup": {
    post: {
      summary: "Fetch a scoped contact and its identifiers via public integration",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicContactLookupRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Scoped contact detail",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PublicContactResponse" } },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or customer not found" },
      },
      description:
        "The `x-signature` HMAC must cover the exact raw JSON body containing `businessSlug` and `customerId`.",
    },
  },
  "/api/v1/public/contact-identifiers": {
    post: {
      summary: "Link a contact identifier to a scoped contact via public integration",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicContactIdentifierLinkRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Identifier linked successfully",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicContactIdentifierLinkResponse" },
            },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or customer not found" },
        409: { description: "Identifier already linked or inactive" },
      },
    },
  },
  "/api/v1/public/contact-identifiers/resolve": {
    post: {
      summary: "Resolve a scoped contact identifier via public integration",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicContactIdentifierResolveRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Contact resolved successfully",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicContactIdentifierResolveResponse" },
            },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or identifier not found" },
      },
    },
  },
  "/api/v1/public/contact-identifiers/unlink": {
    post: {
      summary: "Unlink a scoped contact identifier via public integration",
      parameters: [publicHmacHeaderParameter],
      "x-hmac-required": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicContactIdentifierUnlinkRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Identifier unlinked successfully",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicContactIdentifierUnlinkResponse" },
            },
          },
        },
        400: { description: "Validation error" },
        401: { description: "Invalid signature" },
        404: { description: "Business or identifier not found" },
      },
    },
  },
  "/api/v1/customer/me": {
    get: {
      summary: "Get the current customer profile",
      security: [{ customerAuth: [] }],
      responses: {
        200: {
          description: "Current customer profile",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerProfileResponse" },
            },
          },
        },
        401: { description: "Not authenticated" },
      },
    },
    delete: {
      summary: "Delete the current customer account",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer account deleted" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/customer/history": {
    get: {
      summary: "Get the current customer's transaction and redemption history",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer history" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/customer/rewards": {
    get: {
      summary: "List rewards available to the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Available rewards" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/customer/export": {
    get: {
      summary: "Export the current customer's data",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer data export" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/customer/referral-code": {
    get: {
      summary: "Get or create the current customer's referral code",
      security: [{ customerAuth: [] }],
      responses: {
        200: {
          description: "Referral code",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ReferralCodeResponse" } },
          },
        },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/customer/tier": {
    get: {
      summary: "Get the current customer's tier information",
      security: [{ customerAuth: [] }],
      responses: {
        200: {
          description: "Tier info",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/TierInfoResponse" } },
          },
        },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/admin/tiers": {
    get: {
      summary: "List business tiers",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Tier list" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role required" },
      },
    },
    post: {
      summary: "Create a business tier",
      security: [{ staffAuth: [] }],
      responses: {
        201: { description: "Tier created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role required" },
      },
    },
  },
  "/api/v1/admin/plan": {
    get: {
      summary: "Get the current business plan, limits, and features",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Plan detail" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/admin/rewards": {
    get: {
      summary: "List rewards for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Reward list" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
    post: {
      summary: "Create a reward",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Reward created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Reward updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        404: { description: "Reward not found" },
      },
    },
  },
  "/api/v1/admin/branches": {
    get: {
      summary: "List branches for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Branch list" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
    post: {
      summary: "Create a branch",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Branch created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
  },
  "/api/v1/admin/staff": {
    get: {
      summary: "List staff users for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Staff list" },
        401: { description: "Not authenticated" },
        403: { description: "Role not allowed" },
      },
    },
    post: {
      summary: "Create a staff user",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Staff user created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Role not allowed" },
        409: { description: "Email already registered" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Staff user updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Role not allowed" },
        404: { description: "Staff user not found" },
      },
    },
  },
  "/api/v1/admin/webhooks": {
    get: {
      summary: "List webhook endpoints for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Webhook endpoint list" },
        401: { description: "Not authenticated" },
        403: { description: "Role not allowed" },
      },
    },
    post: {
      summary: "Create a webhook endpoint",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Webhook endpoint created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Role not allowed" },
      },
    },
  },
  "/api/v1/admin/gift-cards": {
    get: {
      summary: "List gift cards for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Gift card list" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
    post: {
      summary: "Create a gift card",
      security: [{ staffAuth: [] }],
      responses: {
        201: { description: "Gift card created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
      },
    },
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
          schema: { type: "string" },
        },
      ],
      responses: {
        200: { description: "Gift card detail" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled or role not allowed" },
        404: { description: "Gift card not found" },
      },
    },
  },
  "/api/v1/super/plans": {
    get: {
      summary: "List configurable plans",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Available plan configuration" },
        401: { description: "Not authenticated" },
      },
    },
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
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperPlanFeaturesRequest" } },
        },
      },
      responses: {
        200: { description: "Updated plan features" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/super/businesses": {
    get: {
      summary: "List businesses visible to the super admin",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Business list" },
        401: { description: "Not authenticated" },
      },
    },
    post: {
      summary: "Create a business and owner from the super admin panel",
      security: [{ superAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SuperCreateBusinessRequest" },
          },
        },
      },
      responses: {
        201: { description: "Business created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SuperPlanUpdateRequest" } },
        },
      },
      responses: {
        200: { description: "Business plan updated" },
        400: { description: "Validation error" },
        404: { description: "Business not found" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Business user list" },
        404: { description: "Business not found" },
      },
    },
    post: {
      summary: "Create a staff user for a business",
      security: [{ superAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "businessId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SuperCreateBusinessUserRequest" },
          },
        },
      },
      responses: {
        201: { description: "Business user created" },
        400: { description: "Validation error" },
        404: { description: "Business not found" },
        409: { description: "Email already registered" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Impersonation cookie issued" },
        404: { description: "No eligible staff user found" },
      },
    },
  },
  "/api/v1/admin/analytics/calculate": {
    post: {
      summary: "Queue an analytics recalculation job",
      security: [{ staffAuth: [] }],
      responses: {
        202: { description: "Analytics recalculation queued" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role required" },
      },
    },
  },
  "/api/v1/admin/jobs": {
    get: {
      summary: "List background jobs for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Background jobs list" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role required" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Background job details" },
        404: { description: "Job not found" },
      },
    },
  },
  "/api/v1/customer/achievements": {
    get: {
      summary: "Get earned and in-progress achievements for the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer achievements" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/customer/challenges": {
    get: {
      summary: "Get active challenges and progress for the current customer",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer challenges" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/customer/streak": {
    get: {
      summary: "Get the current customer's visit streak",
      security: [{ customerAuth: [] }],
      responses: {
        200: { description: "Customer streak" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
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
          schema: { type: "string", enum: ["points", "streak"] },
        },
      ],
      responses: {
        200: { description: "Leaderboard position" },
        400: { description: "Invalid leaderboard type" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/admin/achievements": {
    get: {
      summary: "List gamification achievements for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Achievement list" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
    post: {
      summary: "Create a gamification achievement",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AchievementCreateRequest" } },
        },
      },
      responses: {
        201: { description: "Achievement created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AchievementUpdateRequest" } },
        },
      },
      responses: {
        200: { description: "Achievement updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
      },
    },
    delete: {
      summary: "Delete an achievement",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Achievement deleted" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Achievement not found" },
      },
    },
  },
  "/api/v1/admin/challenges": {
    get: {
      summary: "List active challenges for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Challenge list" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
    post: {
      summary: "Create a challenge",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ChallengeCreateRequest" } },
        },
      },
      responses: {
        201: { description: "Challenge created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ChallengeUpdateRequest" } },
        },
      },
      responses: {
        200: { description: "Challenge updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Challenge not found" },
      },
    },
    delete: {
      summary: "Delete a challenge",
      security: [{ staffAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Challenge deleted" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Challenge not found" },
      },
    },
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
          schema: { type: "string", enum: ["points", "streak"] },
        },
      ],
      responses: {
        200: { description: "Leaderboard data" },
        400: { description: "Invalid leaderboard type" },
        401: { description: "Not authenticated" },
        403: { description: "Plan feature not enabled" },
      },
    },
  },
  "/api/v1/admin/program": {
    get: {
      summary: "Get the current program configuration",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Program configuration" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
    post: {
      summary: "Update the current program configuration",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ProgramUpdateRequest" } },
        },
      },
      responses: {
        200: { description: "Program updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role, permission, and plan feature required" },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/admin/automations": {
    get: {
      summary: "Get lifecycle automation settings and templates",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Automation settings" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/admin/owner-progress": {
    get: {
      summary: 'Get the owner progress ("Tu progreso") for the current business',
      description:
        "Launch path, suggested goal, milestones with first-reached dates, weekly momentum and unacknowledged milestones. Derived from existing records only. Owner role, every plan; 404 when the platform mode is off.",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Owner progress payload" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role required" },
        404: { description: "Owner progress is turned off for the platform" },
      },
    },
  },
  "/api/v1/admin/owner-progress/acknowledge": {
    post: {
      summary: "Acknowledge newly reached milestones",
      description: "Idempotent: unknown or unreached keys are ignored.",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Acknowledged keys and the refreshed progress payload" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role or CSRF token required" },
        404: { description: "Owner progress is turned off for the platform" },
      },
    },
  },
  "/api/v1/admin/owner-progress/goal": {
    post: {
      summary: "Choose or dismiss the suggested goal",
      description:
        "Exactly one of key or dismiss. Dismissed goals are not re-suggested for 30 days.",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Refreshed progress payload" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role or CSRF token required" },
        404: { description: "Owner progress is turned off for the platform" },
      },
    },
  },
  "/api/v1/admin/owner-progress/review": {
    post: {
      summary: "Record an explicit program review (keep or adjust)",
      description: "Timestamps the review and grants the primera_revision milestone.",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Refreshed progress payload" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role or CSRF token required" },
        404: { description: "Owner progress is turned off for the platform" },
      },
    },
  },
  "/api/v1/admin/owner-progress/visibility": {
    post: {
      summary: "Hide or show the owner progress card (persists)",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Refreshed progress payload" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role or CSRF token required" },
        404: { description: "Owner progress is turned off for the platform" },
      },
    },
  },
  "/api/v1/super/platform-settings/owner-progress": {
    get: {
      summary: "Get the platform owner-progress settings (mode and holdout share)",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Current settings" },
        401: { description: "Not authenticated" },
      },
    },
    put: {
      summary: "Update the platform owner-progress settings",
      description:
        "mode: off | checklist | full (default full); holdout_pct: 0-100 (default 0). Variants already assigned to a business are never reassigned.",
      security: [{ superAuth: [] }],
      responses: {
        200: { description: "Saved settings" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "CSRF token required" },
      },
    },
  },
  "/api/v1/admin/campaign-rules": {
    get: {
      summary: "Get campaign rules for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Campaign rules" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
    put: {
      summary: "Update campaign rules for the current business",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/CampaignRulesRequest" } },
        },
      },
      responses: {
        200: { description: "Campaign rules updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/admin/external-awards": {
    get: {
      summary: "Get external award integration settings",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "External awards configuration" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
    put: {
      summary: "Update external award integration settings",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ExternalAwardsRequest" } },
        },
      },
      responses: {
        200: { description: "External awards updated" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and plan feature required" },
        404: { description: "Business not found" },
      },
    },
  },
  "/api/v1/admin/analytics/dashboard": {
    get: {
      summary: "Get analytics dashboard aggregates for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Analytics dashboard" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
  },
  "/api/v1/admin/analytics/first-purchase-returns": {
    get: {
      summary: "Track second purchases within 30 days of first recorded purchase",
      description:
        "Weekly cohort starts Monday in the business timezone; defaults to the previous complete calendar week. Choose among 52 weeks including the current week. First purchase is identified across all available business history before filtering its week and optional branch. A return at any branch must be on a later local date and less than 720 hours later. Complete observation windows form the rate denominator; ongoing windows are separate. Includes only genuine recorded purchases received by the snapshot. Late synchronization and refunds can change results. This is not causal lift or ROI. Responses are private, no-store.",
      security: [{ staffAuth: [] }],
      responses: {
        200: {
          description:
            "Weekly first-purchase cohort, complete and ongoing follow-up, data readiness",
        },
        400: {
          description:
            "Invalid date, non-Monday, out-of-range week, duplicate or unknown filter, or branch outside the current business",
        },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and analytics feature required" },
        404: { description: "Business not found" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Customer analytics profile" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
        404: { description: "Customer not found" },
      },
    },
  },
  "/api/v1/admin/analytics/churn-risk": {
    get: {
      summary: "List high churn-risk customers",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "High churn-risk customers" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
  },
  "/api/v1/admin/analytics/cohorts": {
    get: {
      summary: "Get cohort retention data",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Cohort retention data" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
  },
  "/api/v1/admin/analytics/top-customers": {
    get: {
      summary: "List top customers by LTV",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Top customers" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
  },
  "/api/v1/admin/analytics/rfm": {
    get: {
      summary: "Get RFM distribution for the current business",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "RFM distribution" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
  },
  "/api/v1/admin/analytics/segments": {
    get: {
      summary: "List analytics segments",
      security: [{ staffAuth: [] }],
      responses: {
        200: { description: "Segment list" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
    post: {
      summary: "Create an analytics segment",
      security: [{ staffAuth: [] }],
      responses: {
        201: { description: "Segment created" },
        400: { description: "Validation error" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and analytics feature required" },
      },
    },
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
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Segment customers" },
        401: { description: "Not authenticated" },
        403: { description: "Analytics feature required" },
      },
    },
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
          description: "Inclusive period start. Defaults to 30 days before the end date.",
        },
        {
          in: "query",
          name: "to",
          required: false,
          schema: { type: "string", format: "date" },
          description: "Inclusive period end. Defaults to today.",
        },
      ],
      responses: {
        200: {
          description: "Certification summary and day-level value movement totals",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LedgerCertificationResponse" },
            },
          },
        },
        400: { description: "Invalid date range" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and analytics feature required" },
      },
    },
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
          schema: { type: "string", format: "date" },
        },
        {
          in: "query",
          name: "to",
          required: false,
          schema: { type: "string", format: "date" },
        },
      ],
      responses: {
        200: {
          description: "Ledger certification CSV export",
          content: {
            "text/csv": {
              schema: { type: "string" },
            },
          },
        },
        400: { description: "Invalid date range" },
        401: { description: "Not authenticated" },
        403: { description: "Owner role and analytics feature required" },
      },
    },
  },
};

/** @param {string} routePath */
function normalizeExpressPath(routePath) {
  return String(routePath || "").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** @param {string} pathname */
function inferSecurity(pathname) {
  if (pathname.startsWith("/api/v1/customer/") || pathname === "/api/v1/customer/me")
    return [{ customerAuth: [] }];

  if (
    pathname.startsWith("/api/v1/admin/") ||
    (pathname.startsWith("/api/v1/staff/") && pathname !== "/api/v1/staff/login")
  )
    return [{ staffAuth: [] }];

  if (pathname.startsWith("/api/v1/super/") && pathname !== "/api/v1/super/login") {
    return [{ superAuth: [] }];
  }

  return undefined;
}

/** @param {RouterLayer} layer */
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

/** @param {RouterLayer[]} [layers] */
function collectRouteMiddlewareMeta(layers = []) {
  /** @type {Set<string>} */
  const auths = new Set();
  /** @type {Set<string>} */
  const roles = new Set();
  /** @type {Set<string>} */
  const permissions = new Set();
  /** @type {Set<string>} */
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
    tenantContext,
  };
}

/** @param {string} method @param {string} pathname */
function inferSuccessStatus(method, pathname) {
  const createdPostRoutes = new Set([
    "/api/v1/admin/analytics/segments",
    "/api/v1/admin/achievements",
    "/api/v1/admin/challenges",
    "/api/v1/admin/gift-cards",
    "/api/v1/admin/tiers",
    "/api/v1/public/business/register",
    "/api/v1/super/businesses",
    "/api/v1/super/businesses/{businessId}/users",
  ]);
  if (method === "post" && pathname === "/api/v1/admin/analytics/calculate") return "202";
  if (method === "post" && createdPostRoutes.has(pathname)) return "201";
  if (method === "delete") return "200";
  return "200";
}

/** @param {string} method @param {string} pathname */
function buildDerivedSummary(method, pathname) {
  return `Derived ${method.toUpperCase()} ${pathname}`;
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {ReturnType<typeof collectRouteMiddlewareMeta> | null} [routeMeta]
 */
function buildDerivedOperation(method, pathname, routeMeta = null) {
  /** @type {OpenApiOperation} */
  const operation = {
    summary: buildDerivedSummary(method, pathname),
    responses: {
      [inferSuccessStatus(method, pathname)]: {
        description: "Success",
      },
    },
  };

  const auth = routeMeta?.auths?.[0] || null;
  const security =
    auth === "customer"
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
    schema: { type: "string" },
  }));
  if (params.length) operation.parameters = params;

  if (routeMeta?.csrfRequired) operation["x-csrf-required"] = true;
  if (routeMeta?.tenantContext) operation["x-tenant-context"] = true;
  if (routeMeta?.staffRoles?.length) operation["x-required-roles"] = routeMeta.staffRoles;
  if (routeMeta?.staffPermissions?.length)
    operation["x-required-permissions"] = routeMeta.staffPermissions;
  if (routeMeta?.planFeatures?.length) operation["x-plan-features"] = routeMeta.planFeatures;

  return operation;
}

/**
 * Deep copy via JSON; null and undefined pass through.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** @param {string | string[] | undefined} type */
function jsonSchemaTypeToOpenApiType(type) {
  if (Array.isArray(type)) {
    return type.find((entry) => entry !== "null") || "string";
  }
  return type || "string";
}

/** @param {string} name a component schema name */
function buildQueryParametersFromComponent(name) {
  const schema = components[name];
  if (!schema || jsonSchemaTypeToOpenApiType(schema.type) !== "object") return [];

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties || {}).map(([paramName, paramSchema]) => ({
    in: "query",
    name: paramName,
    required: required.has(paramName),
    schema: clone(paramSchema),
  }));
}

/** @param {string} schemaName */
function buildJsonContent(schemaName) {
  return {
    "application/json": {
      schema: schemaRef(schemaName),
    },
  };
}

/**
 * @param {Record<string, OpenApiResponse>} [responses]
 * @param {Record<string, string>} [schemaBindings] status -> component schema name
 */
function applyResponseSchemas(responses = {}, schemaBindings = {}) {
  const nextResponses = { ...responses };

  for (const [status, schemaName] of Object.entries(schemaBindings || {})) {
    nextResponses[status] = {
      ...(nextResponses[status] || {}),
      content: buildJsonContent(schemaName),
    };
  }

  for (const status of ["400", "401", "403", "404", "409", "422", "429", "500"]) {
    if (!nextResponses[status]) continue;
    if (nextResponses[status].content) continue;
    nextResponses[status] = {
      ...nextResponses[status],
      content: buildJsonContent("ErrorResponse"),
    };
  }

  return nextResponses;
}

/**
 * @param {OpenApiOperation} operation
 * @param {RouteSchemaBinding} [binding]
 */
function applySchemaBindingsToOperation(operation, binding = {}) {
  const next = {
    ...operation,
    parameters: Array.isArray(operation.parameters) ? [...operation.parameters] : undefined,
    responses: { ...(operation.responses || {}) },
  };

  if (binding.body) {
    next.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: schemaRef(binding.body),
        },
      },
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

/**
 * @param {RouterLayer[] | undefined} stack
 * @param {string} [prefix]
 * @param {Map<string, Record<string, OpenApiOperation>>} [paths]
 * @param {RouterLayer[]} [inheritedLayers]
 */
function collectVersionedRoutes(stack, prefix = "", paths = new Map(), inheritedLayers = []) {
  let activeInherited = [...inheritedLayers];

  for (const layer of stack || []) {
    if (layer.route?.path) {
      if (prefix !== "/api/v1") continue;
      const pathname = normalizeExpressPath(`${prefix}${layer.route.path}`);
      if (pathname.includes("/openapi.") || pathname.startsWith("/api/v1/docs")) continue;
      const pathItem = paths.get(pathname) || {};
      const routeMeta = collectRouteMiddlewareMeta([
        ...activeInherited,
        ...(layer.route.stack || []),
      ]);
      for (const method of Object.keys(layer.route.methods || {})) {
        pathItem[method] = applySchemaBindingsToOperation(
          buildDerivedOperation(method, pathname, routeMeta),
          routeSchemaBindings[pathname]?.[method],
        );
      }
      paths.set(pathname, pathItem);
      continue;
    }

    if (layer.name === "router" && layer.handle?.stack) {
      collectVersionedRoutes(layer.handle.stack, prefix, paths, activeInherited);
      continue;
    }

    activeInherited = [...activeInherited, layer];
  }

  return paths;
}

async function deriveRoutePaths() {
  const { apiRouteMounts } = await import("../app/routes/index.js");
  /** @type {Map<string, Record<string, OpenApiOperation>>} */
  const paths = new Map();
  for (const { basePath, router } of apiRouteMounts) {
    if (basePath === "/api/v1") collectVersionedRoutes(router.stack, basePath, paths);
  }
  const derivedEntries = Array.from(paths.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return Object.fromEntries(derivedEntries);
}

/**
 * @param {Record<string, Record<string, OpenApiOperation>>} derivedPaths
 * @param {Record<string, Record<string, OpenApiOperation>>} overridePaths
 */
function mergePaths(derivedPaths, overridePaths) {
  const merged = { ...derivedPaths };
  for (const [pathname, operations] of Object.entries(overridePaths)) {
    const existingPathItem = merged[pathname] || {};
    const nextPathItem = { ...existingPathItem };
    for (const [method, operation] of Object.entries(operations)) {
      const mergedOperation = {
        ...(existingPathItem[method] || {}),
        ...operation,
      };
      if (existingPathItem[method]?.responses || operation.responses) {
        mergedOperation.responses = { ...(existingPathItem[method]?.responses || {}) };
        for (const [status, response] of Object.entries(operation.responses || {})) {
          mergedOperation.responses[status] = {
            ...(existingPathItem[method]?.responses?.[status] || {}),
            ...response,
          };
        }
      }
      nextPathItem[method] = {
        ...mergedOperation,
        responses: applyResponseSchemas(mergedOperation.responses),
      };
    }
    merged[pathname] = nextPathItem;
  }

  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function buildOpenApiDoc() {
  const paths = mergePaths(await deriveRoutePaths(), curatedPaths);

  return {
    openapi: "3.0.3",
    info: {
      title: "PuntosFieles API",
      version: pkg.version,
      description:
        "Route-derived OpenAPI document for versioned /api/v1 routes, with curated request/response metadata layered onto the discovered route surface.",
    },
    servers: [{ url: "https://api.puntos.local" }],
    paths,
    components: {
      securitySchemes: {
        staffAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_staff" },
        customerAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_customer" },
        superAuth: { type: "apiKey", in: "cookie", name: "__Host-pf_super" },
      },
      schemas: components,
    },
  };
}

/** @param {unknown} value */
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

/**
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
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
            const rest = entries
              .slice(1)
              .map(
                ([key, nested]) =>
                  `${" ".repeat(indent + 2)}${key}:${
                    nested && typeof nested === "object"
                      ? `\n${toYaml(nested, indent + 4)}`
                      : ` ${yamlScalar(nested)}`
                  }`,
              )
              .join("\n");
            return `${space}- ${firstKey}: ${yamlScalar(firstValue)}${rest ? `\n${rest}` : ""}`;
          }
          return `${space}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}${
            entries.slice(1).length
              ? `\n${entries
                  .slice(1)
                  .map(
                    ([key, nested]) =>
                      `${" ".repeat(indent + 2)}${key}:${
                        nested && typeof nested === "object"
                          ? `\n${toYaml(nested, indent + 4)}`
                          : ` ${yamlScalar(nested)}`
                      }`,
                  )
                  .join("\n")}`
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
      .map(
        ([key, nested]) =>
          `${space}${key}:${
            nested && typeof nested === "object"
              ? `\n${toYaml(nested, indent + 2)}`
              : ` ${yamlScalar(nested)}`
          }`,
      )
      .join("\n");
  }
  return `${space}${yamlScalar(value)}`;
}

/** @param {Awaited<ReturnType<typeof buildOpenApiDoc>> | null} [doc] */
export async function writeOpenApiFiles(doc) {
  const resolvedDoc = doc || (await buildOpenApiDoc());
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
