-- Platform-wide super-admin actions (plan feature edits, secret rotation) have no
-- tenant. Allow them in audit_logs without a business while every other actor
-- still requires one. RLS already limits rows without a business to platform admins.
ALTER TABLE audit_logs ALTER COLUMN business_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_platform_scope_check'
  ) THEN
    -- Existing rows all have a business, so skipping the validation scan is safe.
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_platform_scope_check
      CHECK (business_id IS NOT NULL OR actor_type = 'SUPER_ADMIN') NOT VALID;
  END IF;
END $$;
