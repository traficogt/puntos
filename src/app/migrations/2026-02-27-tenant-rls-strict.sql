-- Strict, comprehensive tenant RLS.
-- Enforces:
--   - tenant-scoped reads/writes require app.current_tenant() to match business_id
--   - platform ops require app.platform_admin = 'true' (set by server after strong auth)
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean AS $$
  SELECT current_setting('app.platform_admin', true) = 'true';
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- businesses: allow INSERT (signup/bootstrap), restrict reads/writes by tenant or platform.
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_businesses ON businesses;
DROP POLICY IF EXISTS business_select ON businesses;
DROP POLICY IF EXISTS business_insert ON businesses;
DROP POLICY IF EXISTS business_update ON businesses;
DROP POLICY IF EXISTS business_delete ON businesses;

CREATE POLICY business_select ON businesses
  FOR SELECT
  USING (app.is_platform_admin() OR id = app.current_tenant());

CREATE POLICY business_update ON businesses
  FOR UPDATE
  USING (app.is_platform_admin() OR id = app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR id = app.current_tenant());

CREATE POLICY business_delete ON businesses
  FOR DELETE
  USING (app.is_platform_admin() OR id = app.current_tenant());

-- Onboarding creates a business before tenant context exists; allow.
CREATE POLICY business_insert ON businesses
  FOR INSERT
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Tables with NOT NULL business_id
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'branches',
    'staff_users',
    'customers',
    'rewards',
    'transactions',
    'redemptions',
    'verify_codes',
    'qr_tokens',
    'message_logs',
    'webhook_endpoints',
    'audit_logs',
    'lifecycle_events',
    'billing_events',
    'gift_cards',
    'gift_card_transactions',
    -- schema-extensions (if installed)
    'loyalty_tiers',
    'referral_codes',
    'referrals',
    'referral_settings',
    'achievements',
    'challenges',
    'customer_segments',
    'customer_cohorts'
  ]) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())',
      t
    );
  END LOOP;
END$$;

-- ----------------------------------------------------------------------------
-- Tables with NULLable business_id (allow inserts with NULL for global/unmapped events)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'security_events',
    'background_jobs',
    'payment_webhook_events'
  ]) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id IS NULL OR business_id = app.current_tenant())',
      t
    );
  END LOOP;
END$$;

-- ----------------------------------------------------------------------------
-- Join / derived-tenant tables (no direct business_id)
-- ----------------------------------------------------------------------------

-- customer_balances(customer_id -> customers.business_id)
DO $$
BEGIN
  IF to_regclass('customer_balances') IS NOT NULL THEN
    ALTER TABLE customer_balances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_balances FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_balances;
    CREATE POLICY tenant_isolation ON customer_balances
      USING (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = customer_id
            AND c.business_id = app.current_tenant()
        )
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = customer_id
            AND c.business_id = app.current_tenant()
        )
      );
  END IF;
END$$;

-- reward_branches(reward_id -> rewards.business_id)
DO $$
BEGIN
  IF to_regclass('reward_branches') IS NOT NULL THEN
    ALTER TABLE reward_branches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reward_branches FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON reward_branches;
    CREATE POLICY tenant_isolation ON reward_branches
      USING (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM rewards r
          WHERE r.id = reward_id
            AND r.business_id = app.current_tenant()
        )
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM rewards r
          WHERE r.id = reward_id
            AND r.business_id = app.current_tenant()
        )
      );
  END IF;
END$$;

-- webhook_deliveries(endpoint_id -> webhook_endpoints.business_id)
DO $$
BEGIN
  IF to_regclass('webhook_deliveries') IS NOT NULL THEN
    ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
    CREATE POLICY tenant_isolation ON webhook_deliveries
      USING (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM webhook_endpoints e
          WHERE e.id = endpoint_id
            AND e.business_id = app.current_tenant()
        )
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM webhook_endpoints e
          WHERE e.id = endpoint_id
            AND e.business_id = app.current_tenant()
        )
      );
  END IF;
END$$;

-- platform_settings is global; only platform admin should read/write.
DO $$
BEGIN
  IF to_regclass('platform_settings') IS NOT NULL THEN
    ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS platform_admin_only ON platform_settings;
    CREATE POLICY platform_admin_only ON platform_settings
      USING (app.is_platform_admin())
      WITH CHECK (app.is_platform_admin());
  END IF;
END$$;

-- schema-extensions: derived tables based on customer_id / pass_id, etc.
DO $$
BEGIN
  IF to_regclass('customer_tiers') IS NOT NULL THEN
    ALTER TABLE customer_tiers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_tiers FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_tiers;
    CREATE POLICY tenant_isolation ON customer_tiers
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('tier_history') IS NOT NULL THEN
    ALTER TABLE tier_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tier_history FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON tier_history;
    CREATE POLICY tenant_isolation ON tier_history
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('customer_achievements') IS NOT NULL THEN
    ALTER TABLE customer_achievements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_achievements FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_achievements;
    CREATE POLICY tenant_isolation ON customer_achievements
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('customer_challenges') IS NOT NULL THEN
    ALTER TABLE customer_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_challenges FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_challenges;
    CREATE POLICY tenant_isolation ON customer_challenges
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('visit_streaks') IS NOT NULL THEN
    ALTER TABLE visit_streaks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE visit_streaks FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON visit_streaks;
    CREATE POLICY tenant_isolation ON visit_streaks
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('customer_segment_assignments') IS NOT NULL THEN
    ALTER TABLE customer_segment_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_segment_assignments FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_segment_assignments;
    CREATE POLICY tenant_isolation ON customer_segment_assignments
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('customer_ltv') IS NOT NULL THEN
    ALTER TABLE customer_ltv ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_ltv FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_ltv;
    CREATE POLICY tenant_isolation ON customer_ltv
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('customer_cohort_assignments') IS NOT NULL THEN
    ALTER TABLE customer_cohort_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_cohort_assignments FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON customer_cohort_assignments;
    CREATE POLICY tenant_isolation ON customer_cohort_assignments
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('wallet_passes') IS NOT NULL THEN
    ALTER TABLE wallet_passes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE wallet_passes FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON wallet_passes;
    CREATE POLICY tenant_isolation ON wallet_passes
      USING (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.business_id = app.current_tenant())
      );
  END IF;

  IF to_regclass('wallet_pass_updates') IS NOT NULL THEN
    ALTER TABLE wallet_pass_updates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE wallet_pass_updates FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON wallet_pass_updates;
    CREATE POLICY tenant_isolation ON wallet_pass_updates
      USING (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1
          FROM wallet_passes wp
          JOIN customers c ON c.id = wp.customer_id
          WHERE wp.id = pass_id
            AND c.business_id = app.current_tenant()
        )
      )
      WITH CHECK (
        app.is_platform_admin()
        OR EXISTS (
          SELECT 1
          FROM wallet_passes wp
          JOIN customers c ON c.id = wp.customer_id
          WHERE wp.id = pass_id
            AND c.business_id = app.current_tenant()
        )
      );
  END IF;
END$$;
