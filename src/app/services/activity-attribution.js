// Shared by the owner summary and its ledger drill-down. POS service accounts
// identify ingestion, not the cashier who made the sale.
export const activityGroups = ['staff', 'pos', 'orders', 'unmapped', 'other'];
export const activityAttributionSql = `CASE
 WHEN a.source='external' THEN 'pos'
 WHEN a.source='order' THEN 'orders'
 WHEN s.id IS NOT NULL THEN 'staff'
 WHEN a.source IN ('online','offline','reversal','ledger_correction') THEN 'unmapped'
 ELSE 'other' END`;
