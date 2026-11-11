export interface StaffQueueScope { businessId: string; staffId: string; }
export interface CustomerCacheScope { businessId: string; customerId: string; }
export function addAward(award: Partial<import("../../public/staff/types.js").QueuedStaffAward> & { txId: string }): Promise<unknown>;
export function listAwards(options?: Partial<StaffQueueScope> & { statuses?: string[] }): Promise<import("../../public/staff/types.js").QueuedStaffAward[]>;
export function updateAward(txId: string, patch: Record<string, unknown>, scope?: StaffQueueScope): Promise<unknown>;
export function getAwardQueueStats(scope?: StaffQueueScope): Promise<{
  total: number;
  queued: number;
  syncing: number;
  failed: number;
  quarantined: number;
  lastQueuedAt: string;
  lastError: string;
}>;
export function requeueSyncingAwards(scope?: StaffQueueScope): Promise<unknown>;
export function deleteAward(txId: string, scope?: StaffQueueScope): Promise<unknown>;
export function clearAwards(): Promise<unknown>;
export function putCustomerCache(key: string, data: unknown, scope: CustomerCacheScope): Promise<unknown>;
export function getCustomerCacheSnapshot(scope?: CustomerCacheScope): Promise<{
  sections: Record<string, unknown>;
  updatedAt: Record<string, string>;
  latestUpdatedAt: string;
}>;
export function clearCustomerCache(): Promise<unknown>;
