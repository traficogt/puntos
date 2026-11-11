-- Dedicated, disposable database only. Deliberately leave source tables without
-- RLS so the service's explicit tenant predicates are exercised independently.
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$;
CREATE TABLE businesses (id uuid PRIMARY KEY);
CREATE TABLE staff_users (id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id));
CREATE TABLE customers (
  id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL, phone text NOT NULL, deleted_at timestamptz
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL,
  type text DEFAULT 'PURCHASE', amount_q numeric(10,2) NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0, visits integer NOT NULL DEFAULT 0,
  items integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'POSTED',
  source text NOT NULL DEFAULT 'online', original_transaction_id uuid,
  reversed_transaction_id uuid, created_at timestamptz NOT NULL
);
