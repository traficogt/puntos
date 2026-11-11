CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$;
CREATE TABLE businesses (id uuid PRIMARY KEY);
CREATE TABLE staff_users (id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id));
CREATE TABLE customers (
  id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id), name text,
  phone text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_visit_at timestamptz,
  deleted_at timestamptz, UNIQUE(business_id,phone)
);
CREATE TABLE customer_balances (
  customer_id uuid PRIMARY KEY REFERENCES customers(id), points integer NOT NULL DEFAULT 0,
  pending_points integer NOT NULL DEFAULT 0 CHECK(pending_points>=0),
  lifetime_points integer NOT NULL DEFAULT 0 CHECK(lifetime_points>=0), tier text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id), customer_id uuid NOT NULL REFERENCES customers(id),
  staff_user_id uuid REFERENCES staff_users(id), branch_id uuid, type text DEFAULT 'PURCHASE', source text NOT NULL DEFAULT 'online',
  status text NOT NULL DEFAULT 'POSTED', points integer NOT NULL DEFAULT 0, amount_q numeric(10,2) NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0, items integer NOT NULL DEFAULT 0, available_at timestamptz,
  expired_at timestamptz, original_transaction_id uuid, reversed_transaction_id uuid,
  meta jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY, business_id uuid REFERENCES businesses(id), actor_type text NOT NULL,
  actor_id uuid, action text NOT NULL, ip text, ua text, meta jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE ledger_balance_adjustments (
  customer_id uuid REFERENCES customers(id), delta_points integer, delta_pending_points integer, delta_lifetime_points integer
);
CREATE TABLE verify_codes (
  id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id), phone text NOT NULL,
  code_hash text NOT NULL, expires_at timestamptz NOT NULL, failed_attempts integer NOT NULL DEFAULT 0,
  blocked_until timestamptz, last_failed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_marketing_preferences (business_id uuid, customer_id uuid, marketing_opt_in boolean DEFAULT false);
CREATE TABLE branches (id uuid PRIMARY KEY,business_id uuid,name text,code text);
CREATE TABLE rewards (id uuid PRIMARY KEY,business_id uuid,name text);
CREATE TABLE redemptions (id uuid PRIMARY KEY,business_id uuid,customer_id uuid,branch_id uuid,reward_id uuid,points_cost integer,status text,created_at timestamptz,redeemed_at timestamptz);
CREATE TABLE customer_ltv (customer_id uuid,churn_risk_score numeric,total_spend numeric,purchase_frequency numeric,rfm_score integer);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='migration_launch_tenant') THEN
    CREATE ROLE migration_launch_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public,app TO migration_launch_tenant;
GRANT SELECT,INSERT,UPDATE ON customers,customer_balances,transactions,verify_codes TO migration_launch_tenant;
GRANT SELECT,INSERT ON audit_logs TO migration_launch_tenant;
GRANT SELECT ON businesses,staff_users,ledger_balance_adjustments,customer_marketing_preferences TO migration_launch_tenant;
GRANT SELECT ON branches,rewards,redemptions,customer_ltv TO migration_launch_tenant;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['customers','transactions','verify_codes','audit_logs','customer_marketing_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(business_id=app.current_tenant()) WITH CHECK(business_id=app.current_tenant())',t);
  END LOOP;
END $$;
ALTER TABLE customer_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_balances
 USING(EXISTS(SELECT 1 FROM customers c WHERE c.id=customer_id AND c.business_id=app.current_tenant()))
 WITH CHECK(EXISTS(SELECT 1 FROM customers c WHERE c.id=customer_id AND c.business_id=app.current_tenant()));
