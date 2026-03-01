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
