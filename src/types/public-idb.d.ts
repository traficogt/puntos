export function addAward(award: import("../../public/staff/types.js").QueuedStaffAward): Promise<unknown>;
export function listAwards(): Promise<import("../../public/staff/types.js").QueuedStaffAward[]>;
export function deleteAward(txId: string): Promise<unknown>;
export function clearAwards(): Promise<unknown>;
