export interface StaffProfile {
  role: string;
  [key: string]: unknown;
}

export interface StaffMeResponse {
  staff: StaffProfile;
}

export interface StaffPermissionsResponse {
  matrix?: Record<string, string[]>;
}

export interface StaffProgramRule {
  program_type: "SPEND" | "VISIT" | "ITEM";
  program_json?: {
    points_per_q?: number;
    round?: string;
    points_per_visit?: number;
    points_per_item?: number;
  };
}

export interface StaffAwardResponse {
  customerId: string;
  pointsAwarded: number;
  newBalance: number;
  status?: string;
}

export interface StaffSyncResult {
  ok?: boolean;
  txId?: string;
}

export interface StaffSyncResponse {
  results: StaffSyncResult[];
}

export interface StaffRewardOption {
  id: string;
  name: string;
  points_cost: number;
}

export interface StaffRewardsResponse {
  rewards: StaffRewardOption[];
}

export interface StaffRedeemResponse {
  redemptionCode: string;
  newBalance: number;
}

export interface StaffGiftCard {
  balance_q?: number;
  status?: string;
}

export interface StaffGiftRedeemResponse {
  gift_card: StaffGiftCard;
}

export interface StaffLoginPayload {
  email: string;
  password: string;
}

export interface QueuedStaffAward {
  customerQrToken: string;
  amount_q: number;
  visits: number;
  items: number;
  txId: string;
  meta: {
    ui: string;
  };
  client_ts?: string;
}
