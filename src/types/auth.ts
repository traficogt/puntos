import type { RequestHandler } from "express";

/**
 * Shapes the authentication middleware attaches to the Express request and the
 * payloads the browser-session token helpers accept.
 */

/** `req.staff`, set by `requireStaff` (src/middleware/auth.js). */
export interface StaffActor {
  id: string;
  business_id: string;
  /** OWNER | MANAGER | CASHIER (see src/utils/permissions.js). */
  role: string;
  /** Null for staff not pinned to a branch; absent on test doubles. */
  branch_id?: string | null;
  /** Email of the platform operator impersonating this staff account, if any. */
  impersonated_by?: string | null;
}

/** `req.customerAuth`, set by `requireCustomer`. */
export interface CustomerActor {
  id: string;
  business_id: string;
}

/** `req.superAdmin`, set by `requireSuperAdmin`. */
export interface SuperAdminActor {
  email: string;
}

/**
 * A row of `auth_sessions` (or its in-memory test twin). Timestamps arrive as
 * ISO strings from the memory store and as `Date` objects from PostgreSQL.
 */
export interface BrowserSessionRecord {
  id: string;
  session_token_hash: string;
  /** STAFF | CUSTOMER | SUPER */
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  business_id: string | null;
  role: string | null;
  branch_id: string | null;
  impersonated_by: string | null;
  reauth_verified_at: string | Date | null;
  mfa_verified_at: string | Date | null;
  last_seen_at: string | Date | null;
  idle_expires_at: string | Date;
  absolute_expires_at: string | Date;
  invalidated_at: string | Date | null;
  invalidation_reason: string | null;
  meta: Record<string, unknown>;
}

/** Claims accepted by `signStaffToken` (src/utils/auth-token.js). */
export interface StaffTokenPayload {
  /** staff_users.id */
  sid: string;
  /** businesses.id */
  bid: string;
  role?: string | null;
  /** branches.id */
  brid?: string | null;
  /** Impersonating platform operator's email. */
  imp?: string | null;
  reauthVerified?: boolean;
  mfaVerified?: boolean;
}

/** Claims accepted by `signCustomerToken`. */
export interface CustomerTokenPayload {
  /** customers.id */
  cid: string;
  /** businesses.id */
  bid: string;
  /** businesses.slug, stored in the session meta for deep links. */
  slug?: string | null;
}

/** Claims accepted by `signSuperToken`. */
export interface SuperTokenPayload {
  email: string;
  reauthVerified?: boolean;
  mfaVerified?: boolean;
}

/**
 * Metadata the OpenAPI generator (src/scripts/generate-openapi.mjs) reads from
 * a middleware's `__openapi` property to document a route's requirements.
 */
export interface OpenApiMiddlewareMeta {
  auth?: "staff" | "customer" | "super";
  staffRoles?: string[];
  staffPermissions?: string[];
  planFeatures?: string[];
  csrfRequired?: boolean;
  tenantContext?: boolean;
  recentReauth?: boolean;
}

/** An Express middleware that documents itself for the OpenAPI generator. */
export type AnnotatedRequestHandler = RequestHandler & { __openapi?: OpenApiMiddlewareMeta };
