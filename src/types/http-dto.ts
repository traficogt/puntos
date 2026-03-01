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

export interface AdminPlanResponse {
  ok: true;
  plan: string;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
}

export interface AdminProgramResponse {
  ok: true;
  program_type: "SPEND" | "VISIT" | "ITEM";
  program_json: Record<string, unknown>;
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
