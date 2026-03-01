-- CANONICAL TENANT RLS (final desired state)
--
-- This migration re-asserts the intended RLS policy configuration in one place.
-- It exists to prevent policy drift across the historical tenant-rls-* migrations.
--
-- Rules:
-- - Strict tenant isolation by default (no tenant set => no tenant rows visible).
-- - Tenant access requires app.current_tenant() to match the tenant id.
-- - Platform-wide access requires app.platform_admin = 'true'.
-- - Payment webhook ingestion can access ONLY business_id IS NULL rows when app.webhook_ingest = 'true'.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean AS $$
  SELECT current_setting('app.platform_admin', true) = 'true';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app.is_webhook_ingest() RETURNS boolean AS $$
  SELECT current_setting('app.webhook_ingest', true) = 'true';
$$ LANGUAGE sql STABLE;

-- Helper: drop all policies on a table (public schema).
DO $$
DECLARE
  t text;
  p record;
BEGIN
  -- ----------------------------------------------------------------------------
  -- businesses (contains password_hash; only platform admin or the current tenant may read)
  -- ----------------------------------------------------------------------------
  IF to_regclass('businesses') IS NOT NULL THEN
    ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'businesses' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON businesses', p.polname);
    END LOOP;

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

    -- Onboarding creates a business before tenant context exists.
    CREATE POLICY business_insert ON businesses
      FOR INSERT
      WITH CHECK (true);
  END IF;

  -- ----------------------------------------------------------------------------
  -- Tenant tables with NOT NULL business_id
  -- ----------------------------------------------------------------------------
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.polname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())',
      t
    );
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- Tables with NULLable business_id
  --
  -- Default policy still requires either:
  -- - platform admin, or
  -- - an explicit tenant context matching business_id
  --
  -- Do NOT allow arbitrary inserts with business_id NULL unless a table has a
  -- dedicated ingest-mode policy (see payment_webhook_events).
  -- ----------------------------------------------------------------------------
  FOR t IN SELECT unnest(ARRAY[
    'security_events',
    'background_jobs'
  ]) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.polname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())',
      t
    );
  END LOOP;

  -- payment_webhook_events: ingest-mode can read/insert/update ONLY business_id IS NULL rows,
  -- without enabling broad platform_admin mode.
  IF to_regclass('payment_webhook_events') IS NOT NULL THEN
    ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_webhook_events FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payment_webhook_events' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON payment_webhook_events', p.polname);
    END LOOP;

    -- Tenant/platform access for mapped rows.
    CREATE POLICY payment_tenant_all ON payment_webhook_events
      FOR ALL
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());

    -- Ingest-mode access for unmapped rows (business_id IS NULL).
    CREATE POLICY payment_ingest_select ON payment_webhook_events
      FOR SELECT
      USING (business_id IS NULL AND app.is_webhook_ingest());

    CREATE POLICY payment_ingest_insert ON payment_webhook_events
      FOR INSERT
      WITH CHECK (business_id IS NULL AND app.is_webhook_ingest());

    CREATE POLICY payment_ingest_update ON payment_webhook_events
      FOR UPDATE
      USING (business_id IS NULL AND app.is_webhook_ingest())
      WITH CHECK (business_id IS NULL AND app.is_webhook_ingest());
  END IF;

  -- ----------------------------------------------------------------------------
  -- Join / derived-tenant tables (no direct business_id)
  -- ----------------------------------------------------------------------------

  -- customer_balances(customer_id -> customers.business_id)
  IF to_regclass('customer_balances') IS NOT NULL THEN
    ALTER TABLE customer_balances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_balances FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_balances' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_balances', p.polname);
    END LOOP;
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

  -- reward_branches(reward_id -> rewards.business_id)
  IF to_regclass('reward_branches') IS NOT NULL THEN
    ALTER TABLE reward_branches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reward_branches FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reward_branches' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON reward_branches', p.polname);
    END LOOP;
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

  -- webhook_deliveries(endpoint_id -> webhook_endpoints.business_id)
  IF to_regclass('webhook_deliveries') IS NOT NULL THEN
    ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'webhook_deliveries' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON webhook_deliveries', p.polname);
    END LOOP;
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

  -- platform_settings is global; only platform admin should read/write.
  IF to_regclass('platform_settings') IS NOT NULL THEN
    ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'platform_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON platform_settings', p.polname);
    END LOOP;
    CREATE POLICY platform_admin_only ON platform_settings
      USING (app.is_platform_admin())
      WITH CHECK (app.is_platform_admin());
  END IF;

  -- ----------------------------------------------------------------------------
  -- schema-extensions: derived tenant tables based on customer_id / pass_id, etc.
  -- ----------------------------------------------------------------------------

  IF to_regclass('customer_tiers') IS NOT NULL THEN
    ALTER TABLE customer_tiers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_tiers FORCE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_tiers' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_tiers', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tier_history' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON tier_history', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_achievements' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_achievements', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_challenges' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_challenges', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'visit_streaks' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON visit_streaks', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_segment_assignments' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_segment_assignments', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_ltv' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_ltv', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_cohort_assignments' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON customer_cohort_assignments', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallet_passes' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON wallet_passes', p.polname);
    END LOOP;
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
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallet_pass_updates' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON wallet_pass_updates', p.polname);
    END LOOP;
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
