-- Lifecycle automations (winback/birthday) deliver via Apple/Google Wallet push when
-- the customer has an active pass, falling back to SMS/email otherwise. The marketing
-- line rides on the pass as a transient, self-expiring message: Apple shows the
-- lock-screen alert through a changeMessage field, Google through the object's
-- messages[]. Both columns are additive and nullable; existing passes are unaffected,
-- and an installed app never needs these fields. No new grants: the runtime role's
-- table privileges already cover added columns on this loyalty-owned table.
ALTER TABLE native_wallet_passes
  ADD COLUMN IF NOT EXISTS pending_message TEXT,
  ADD COLUMN IF NOT EXISTS pending_message_expires_at TIMESTAMPTZ;
