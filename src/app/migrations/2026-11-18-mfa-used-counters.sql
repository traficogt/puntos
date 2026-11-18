-- Single-use enforcement for TOTP codes (RFC 6238 §5.2): record each accepted
-- time-step counter per account so the same 6-digit code cannot be replayed
-- within its validity window (login / step-up reauth).
--
-- Deliberately NOT tenant-scoped and NOT RLS-protected: it is keyed by account
-- (staff uuid or the 'SUPER' singleton), is written during login *before* any
-- tenant context exists, and holds no business data. The rls-check enumerates
-- only tables with a business_id column, so this table is correctly out of scope
-- for tenant RLS.
CREATE TABLE IF NOT EXISTS mfa_used_counters (
  account_type TEXT NOT NULL,          -- 'STAFF' | 'SUPER'
  account_id   TEXT NOT NULL,          -- staff user id, or 'SUPER'
  counter      BIGINT NOT NULL,        -- TOTP time-step counter that was accepted
  used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_type, account_id, counter)
);

-- Supports pruning old rows (counters are monotonic; retention jobs delete by age).
CREATE INDEX IF NOT EXISTS idx_mfa_used_counters_used_at ON mfa_used_counters(used_at);

-- Runtime roles need SELECT/INSERT to enforce single-use during login. Default
-- privileges already cover tables created by the owner, but grant explicitly so
-- login cannot break on default-privilege timing. Owner (loyalty) is a no-op.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.mfa_used_counters TO %I', r);
    END IF;
  END LOOP;
END $$;
