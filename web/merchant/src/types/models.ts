import type { ProgramBasics } from './api';

export interface InventoryEvidence {
  state?: string;
  quantity?: number | string;
  observedAt?: string;
}
export interface RewardMapping {
  enabled: boolean;
  inventory_required: boolean;
  branch_id: string | null;
  quantity: number | string;
  inventory?: InventoryEvidence;
}
export interface ReadinessReward {
  id: string;
  name: string;
  active: boolean;
  points_cost: number;
  stock?: number | null;
  valid_until?: string | null;
  unit_cost_q?: number | string | null;
  branch_ids?: string[];
  mappings?: RewardMapping[];
}
export interface LaunchReadinessInput {
  program?: ProgramBasics;
  rewards?: ReadinessReward[];
  pilot?: { checks?: { required: boolean; status: string }[] };
  branches?: { id: string; name: string }[];
}
export interface InstallationPlan {
  mode: string | null;
  title: string;
  detail: string;
  cashier: string;
  versionNote: string;
  prerequisites: string[];
  offline: string;
  sources: {title: string; url: string}[];
  addon?: {version: string; odooVersion: string; downloadUrl: string; enabled: boolean};
}
export interface RewardPayload {
  rewardId?: string;
  version?: number;
  reward: {
    name: string;
    description: string | null;
    points_cost: number;
    active: boolean;
    stock: number | null;
    valid_until: string | null;
    branch_ids: string[];
  };
  unitCostQ?: number | null;
  available: boolean;
  mapping?: {
    id?: string;
    version: number;
    catalogItemId: string;
    branchId: string | null;
    quantity: number;
    inventoryRequired: boolean;
    enabled: boolean;
  };
}
