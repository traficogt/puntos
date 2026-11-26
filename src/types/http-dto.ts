export interface AdminSignupPayload {
  businessName: string;
  email: string;
  phone?: string;
  password: string;
  category?: string;
  program_type?: "SPEND" | "VISIT" | "ITEM";
  program_json?: Record<string, unknown>;
  captcha_token?: string;
}

export interface AdminSignupResponse {
  ok: true;
  business: {
    id: string;
    slug: string;
    name: string;
  };
}

/** Trial status as the owner app reasons about it (src/app/services/trial-state.js). */
export type TrialStatus = "active" | "expiring" | "locked" | "converted" | "none";

/** `billing` block shared by /api/admin/plan and /api/admin/trial. */
export interface OwnerBillingState {
  /** none | trialing | locked | active | past_due | canceled */
  status: string;
  currency: string | null;
  /** recurrente | stripe | manual | null */
  provider: string | null;
  subscription: {
    plan: string;
    quantity: number;
    currency: string;
    unit_amount_minor: number;
    status: string;
    current_period_end: string | null;
    cancel_at: string | null;
  } | null;
  purge_after: string | null;
}

export interface AdminPlanResponse {
  ok: true;
  plan: string;
  /** Display name (Conecta / Impulsa / Expande); additive, absent on older servers. */
  plan_name?: string;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
  /** Soft-cap usage; active_customers is null if the count could not be computed. */
  usage?: { active_customers: number | null };
  /** Additive trial summary for the Mantine banner; absent on older servers. */
  trial?: {
    status: TrialStatus;
    started_at: string | null;
    ends_at: string | null;
    days_left: number | null;
    upgrade_url: string;
  };
  billing?: OwnerBillingState;
}

export interface AdminTrialResponse {
  ok: true;
  trial: {
    status: TrialStatus;
    days_left: number | null;
    started_at: string | null;
    ends_at: string | null;
    /** Long Spanish date of the trial end in the business timezone. */
    ends_on: string | null;
    locked_at: string | null;
    purge_after: string | null;
    purge_on: string | null;
    plan: string;
    plan_name: string;
    upgrade_url: string;
    /** False until the billing adapter (wave 2) offers online checkout. */
    upgrade_available: boolean;
    copy: {
      banner: string;
      banner_cta: string;
      locked_title: string;
      locked_body: string;
      locked_still_works: readonly string[];
      retention: string;
      upgrade_pending: string;
    };
  };
  billing: OwnerBillingState;
}

/** Body of POST /api/public/trial/signup. */
export interface PublicTrialSignupPayload {
  grant: string;
  businessName: string;
  email: string;
  password: string;
  category?: string;
  turnstileToken: string;
  /** Plan the visitor intended to buy (remembered for the upgrade step). */
  plan?: "EMPRENDEDOR" | "NEGOCIO" | "EMPRESA";
}

export interface PublicTrialSignupResponse {
  ok: true;
  business: { id: string; slug: string; name: string; plan: string; plan_name: string };
  trial: {
    status: TrialStatus;
    days_left: number | null;
    started_at: string | null;
    ends_at: string | null;
  };
  intended_plan: string | null;
  join_url: string;
  next_url: string;
}

/** One subscription as GET /api/admin/billing and its mutations return it. */
export interface AdminBillingSubscription {
  id: string;
  /** recurrente | manual */
  provider: string;
  plan: string;
  plan_name: string;
  quantity: number;
  currency: string;
  unit_amount_minor: number;
  monthly_total_minor: number;
  /** active | past_due | paused | canceled */
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  past_due_since: string | null;
  next_payment_attempt_at: string | null;
  latest_tax_invoice_url: string | null;
  /** A downgrade waiting for the next cycle (design section 6). */
  pending_plan: string | null;
  pending_quantity: number | null;
}

/** GET /api/admin/billing (design sections 4.4 and 7.3, wave 2). */
export interface AdminBillingResponse {
  ok: true;
  billing: {
    /** none | trialing | locked | active | past_due | canceled */
    status: string;
    provider: string | null;
    currency: "GTQ" | "USD";
    plan: string;
    plan_name: string;
    quantity: number;
    unit_amount_minor: number | null;
    monthly_total_minor: number | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at: string | null;
    past_due_since: string | null;
    next_payment_attempt_at: string | null;
    latest_tax_invoice_url: string | null;
    /** A hosted checkout can start (provider configured, catalog ready, no active subscription). */
    upgrade_available: boolean;
    /** POST /api/admin/billing/change applies (active provider subscription). */
    change_available: boolean;
    checkout_pending: { id: string; url: string; expires_at: string | null } | null;
    /** Why billing_status is locked: trial_expired | payment_failed | canceled; null otherwise. */
    lock_reason: "trial_expired" | "payment_failed" | "canceled" | null;
    subscription: AdminBillingSubscription | null;
  };
  catalog: {
    currency: "GTQ" | "USD";
    currencies: string[];
    plans: Array<{ id: string; name: string; unit_amount_minor: number; monthly: number }>;
  };
  branches: number;
  trial: { status: TrialStatus; days_left: number | null; ends_at: string | null };
}

/** POST /api/admin/billing/checkout: 201 when created, 200 when a pending checkout is reused. */
export interface AdminBillingCheckoutResponse {
  ok: true;
  reused: boolean;
  checkout: {
    id: string;
    url: string;
    expires_at: string | null;
    plan: string;
    quantity: number;
    currency: string;
    unit_amount_minor: number;
  };
}

/** GET /api/admin/billing/checkout/:id, polled after the hosted checkout returns. */
export interface AdminBillingCheckoutStatusResponse {
  ok: true;
  status: "pending" | "completed" | "expired" | "canceled";
  checkout: AdminBillingCheckoutResponse["checkout"] & { status: string };
  subscription: AdminBillingSubscription | null;
}

/** GET /api/admin/billing/invoices: payment outcomes with the processor's receipt link when present. */
export interface AdminBillingInvoicesResponse {
  ok: true;
  invoices: Array<{
    occurred_at: string | null;
    amount_minor: number | null;
    currency: string | null;
    status: "paid" | "failed" | "refunded";
    tax_invoice_url: string | null;
    fee_minor: number | null;
    intent_id: string | null;
  }>;
}

/** The 402 body every staff mutation receives while a trial is locked. */
export interface TrialLockedError {
  error: string;
  code: "TRIAL_LOCKED";
  trial_status: "locked";
  trial_ends_at: string | null;
  purge_after: string | null;
  upgrade_url: string;
}

export interface AdminProgramResponse {
  ok: true;
  program_type: "SPEND" | "VISIT" | "ITEM";
  program_json: Record<string, unknown>;
}

export interface BusinessCustomerBranding {
  branding_mode: "platform_led" | "endorsed_brand" | "white_label_ready";
  customer_program_name?: string;
  customer_logo_url?: string;
  primary_color?: string;
  accent_color?: string;
  neutral_theme?: "warm" | "neutral" | "cool";
  powered_by_visible: boolean;
  wallet_headline?: string;
  join_headline?: string;
}

export interface AdminBrandingResponse {
  ok: true;
  customer_branding: BusinessCustomerBranding;
}

export interface SuperLoginPayload {
  email: string;
  password: string;
}

export interface SuperLoginResponse {
  ok: true;
  email: string;
}

export interface SuperBusinessCreatePayload {
  businessName: string;
  email: string;
  phone?: string;
  password: string;
  category?: string;
  program_type?: "SPEND" | "VISIT" | "ITEM";
  program_json?: Record<string, unknown>;
  plan?: string;
}

export interface SuperBusinessCreateResponse {
  ok: true;
  business: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
  ownerId: string;
}

export interface SuperBusinessUserCreatePayload {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role?: "OWNER" | "MANAGER" | "CASHIER";
  branch_id?: string;
  can_manage_gift_cards?: boolean;
  allow_multi_owner?: boolean;
}

export interface SuperBusinessUserCreateResponse {
  ok: true;
  user: {
    id: string;
    business_id: string;
    branch_id: string | null;
    name: string;
    email: string;
    role: string;
    active: boolean;
    can_manage_gift_cards: boolean;
  };
}

export interface SuperPlanUpdatePayload {
  plan: string;
}

export interface SuperPlanFeaturesPayload {
  features: Record<string, boolean>;
}
