-- Allow a cashback balance to go negative so a refund can FULLY claw back the
-- store credit a sale accrued, even after the member already spent it. Without
-- this, the non-negative CHECK forced the clawback to stop at zero and the
-- already-spent portion leaked (refunded sale, credit kept).
--
-- Safe: only CASHBACK-program refunds ever drive the balance negative; spending
-- stays guarded by an explicit balance check, and gift-card wallets (same table)
-- are never reversed, so they remain >= 0 in practice. Drops a constraint only —
-- no table/column change, backward-compatible, no app update required.

ALTER TABLE cashback_accounts DROP CONSTRAINT IF EXISTS cashback_accounts_balance_nonneg;
