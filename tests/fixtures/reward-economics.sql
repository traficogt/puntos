-- Disposable database only; minimal production-compatible redemption/ledger shape.
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.platform_admin', true),''),'false')::boolean $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='economics_test_app') THEN CREATE ROLE economics_test_app NOLOGIN; END IF; END $$;
CREATE TABLE IF NOT EXISTS businesses(id uuid PRIMARY KEY,plan text NOT NULL);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS program_json jsonb DEFAULT '{}';
CREATE TABLE IF NOT EXISTS staff_users(id uuid PRIMARY KEY,business_id uuid NOT NULL,role text DEFAULT 'OWNER',active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY,business_id uuid NOT NULL,deleted_at timestamptz,last_visit_at timestamptz);
CREATE TABLE IF NOT EXISTS customer_balances(customer_id uuid PRIMARY KEY,points integer DEFAULT 0,pending_points integer DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS rewards(id uuid PRIMARY KEY,business_id uuid NOT NULL,name text NOT NULL,points_cost int NOT NULL,active boolean DEFAULT true,stock integer,valid_until timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS redemptions(id uuid PRIMARY KEY,business_id uuid NOT NULL,branch_id uuid,reward_id uuid REFERENCES rewards(id) ON DELETE CASCADE,customer_id uuid NOT NULL,staff_user_id uuid,code text UNIQUE,points_cost int NOT NULL,status text DEFAULT 'REDEEMED',redeemed_at timestamptz,created_at timestamptz DEFAULT now(),request_id uuid,balance_after integer,UNIQUE(business_id,request_id));
CREATE TABLE IF NOT EXISTS transactions(id uuid PRIMARY KEY,business_id uuid NOT NULL,branch_id uuid,customer_id uuid NOT NULL,staff_user_id uuid,amount_q numeric(10,2) DEFAULT 0,points int DEFAULT 0,source text DEFAULT 'online',type text DEFAULT 'PURCHASE',status text DEFAULT 'POSTED',visits int DEFAULT 0,items int DEFAULT 0,original_transaction_id uuid,reversed_transaction_id uuid,meta jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs(id uuid PRIMARY KEY,business_id uuid,actor_type text,actor_id uuid,action text,ip text,ua text,meta jsonb,created_at timestamptz DEFAULT now());
