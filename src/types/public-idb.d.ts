export function addAward(award: import("../../public/staff/types.js").QueuedStaffAward): Promise<unknown>;
export function listAwards(options?: { statuses?: string[] }): Promise<import("../../public/staff/types.js").QueuedStaffAward[]>;
export function updateAward(txId: string, patch: Record<string, unknown>): Promise<unknown>;
export function getAwardQueueStats(): Promise<{
  total: number;
  queued: number;
  syncing: number;
  failed: number;
  lastQueuedAt: string;
  lastError: string;
}>;
export function requeueSyncingAwards(): Promise<unknown>;
export function deleteAward(txId: string): Promise<unknown>;
export function clearAwards(): Promise<unknown>;
export function putCustomerCache(key: string, data: unknown): Promise<unknown>;
export function getCustomerCacheSnapshot(): Promise<{
  sections: Record<string, unknown>;
  updatedAt: Record<string, string>;
  latestUpdatedAt: string;
}>;
export function clearCustomerCache(): Promise<unknown>;
