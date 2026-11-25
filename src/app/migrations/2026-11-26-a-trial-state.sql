-- Self-serve trial state on businesses. Design of record:
-- docs/product/2026-11-25-self-serve-trial.md (section 3.1).
--
-- Additive and backward-compatible: every existing business keeps
-- signup_source='internal', trial_status='none' and billing_status='none', which the
-- entitlement middleware never restricts. `plan` stays the entitlement; billing_status
-- is the access state; trial_status records history for measurement.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS signup_source TEXT NOT NULL DEFAULT 'internal'
    CHECK (signup_source IN ('internal','self_serve','super','api')),
  ADD COLUMN IF NOT EXISTS trial_status TEXT NOT NULL DEFAULT 'none'
    CHECK (trial_status IN ('none','active','expired','converted')),
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_phone TEXT
    CHECK (trial_phone IS NULL OR trial_phone ~ '^[0-9]{8,15}$'),
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none'
    CHECK (billing_status IN ('none','trialing','active','past_due','canceled','locked')),
  ADD COLUMN IF NOT EXISTS billing_currency TEXT
    CHECK (billing_currency IS NULL OR billing_currency IN ('GTQ','USD')),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_trial_dates'
      AND conrelid = 'businesses'::regclass
  ) THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_trial_dates CHECK (
      ((trial_status = 'none') = (trial_started_at IS NULL))
      AND ((trial_started_at IS NULL) = (trial_ends_at IS NULL))
    );
  END IF;
END $$;

-- One trial per verified phone.
CREATE UNIQUE INDEX IF NOT EXISTS businesses_trial_phone_unique
  ON businesses(trial_phone) WHERE trial_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS businesses_trial_due
  ON businesses(trial_ends_at) WHERE trial_status = 'active';
CREATE INDEX IF NOT EXISTS businesses_purge_due
  ON businesses(purge_after) WHERE billing_status = 'locked';
