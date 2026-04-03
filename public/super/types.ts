export interface SuperPlanFeatureMap {
  [key: string]: boolean;
}

export interface SuperPlanLimits {
  branches?: number;
  rewards?: number;
  activeCustomers?: number;
  [key: string]: unknown;
}

export interface SuperPlanPricing {
  monthly?: number;
  yearly?: number;
}

export interface SuperPlanMessaging {
  included_messages?: number;
  overage_per_message_q?: number;
}

export interface SuperPlanDefinition {
  plan: string;
  features?: SuperPlanFeatureMap;
  limits?: SuperPlanLimits;
  pricing_gtq?: SuperPlanPricing;
  messaging_gtq?: SuperPlanMessaging;
}

export interface SuperBusinessRow {
  id: string;
  name: string;
  slug?: string | null;
  plan: string;
  customers?: number;
  staff?: number;
}

export interface SuperStaffRow {
  id: string;
  business_id: string;
  branch_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  active?: boolean;
  can_manage_gift_cards?: boolean;
  created_at?: string;
}

export interface SuperCustomerRow {
  id: string;
  phone?: string | null;
  name?: string | null;
  created_at?: string;
  last_visit_at?: string | null;
  points?: number;
  pending_points?: number;
  lifetime_points?: number;
}

export interface SuperSecurityEvent {
  created_at?: string;
  event_type: string;
  method?: string | null;
  route?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

export interface SuperPlansResponse {
  plans?: SuperPlanDefinition[];
}

export interface SuperBusinessesResponse {
  businesses?: SuperBusinessRow[];
}

export interface SuperStaffListResponse {
  rows?: SuperStaffRow[];
}

export interface SuperCustomerListResponse {
  rows?: SuperCustomerRow[];
}

export interface SuperMagicLinkResponse {
  ok?: boolean;
  id?: string;
  url?: string;
  expiresAt?: string;
  usageMode?: string;
}

export interface SuperSecurityPostureResponse {
  counts?: Record<string, number>;
  recent?: SuperSecurityEvent[];
}

export interface SuperBusinessCreateResponse {
  business?: {
    name?: string;
  };
}

export interface SuperBusinessUserCreateResponse {
  user?: {
    email?: string;
    name?: string;
    role?: string;
  };
}
