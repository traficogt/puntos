CREATE TABLE pos_checkout_sources(
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,source text NOT NULL,
 branch_id uuid REFERENCES branches(id),staff_user_id uuid NOT NULL REFERENCES staff_users(id),enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(business_id,source)
);
CREATE TABLE pos_checkout_intents(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,source text NOT NULL,branch_id uuid REFERENCES branches(id),
 request_id uuid NOT NULL,cart_id text NOT NULL,cart_line_id text NOT NULL,customer_id uuid REFERENCES customers(id),
 fingerprint text CHECK(fingerprint IS NULL OR fingerprint~'^[a-f0-9]{64}$'),status text NOT NULL CHECK(status IN('authorized','recorded','cancelled')),
 redemption_id uuid UNIQUE REFERENCES redemptions(id),redemption_request_id uuid,staff_user_id uuid REFERENCES staff_users(id),
 authorization_snapshot jsonb,completion_payload jsonb,quota_decremented boolean NOT NULL DEFAULT false,
 cancel_request_id uuid,cancel_fingerprint text,cancel_reason text,reversal_id uuid REFERENCES transactions(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,recorded_at timestamptz,
 UNIQUE(business_id,source,request_id),UNIQUE(business_id,source,cart_line_id),UNIQUE(business_id,source,cancel_request_id),
 CHECK(status='cancelled' OR (customer_id IS NOT NULL AND redemption_id IS NOT NULL AND authorization_snapshot IS NOT NULL AND fingerprint IS NOT NULL))
);
CREATE UNIQUE INDEX pos_checkout_one_pending_customer ON pos_checkout_intents(business_id,customer_id) WHERE status='authorized';
CREATE TABLE reward_workspace_requests(
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,request_id uuid NOT NULL,fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(business_id,request_id)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['pos_checkout_sources','pos_checkout_intents','reward_workspace_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);END LOOP;
END$$;

-- Monotonic implementation markers: old program forms cannot erase guards.
CREATE FUNCTION app.preserve_reward_integration_guards() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text;
BEGIN
 FOREACH key IN ARRAY ARRAY['pos_inventory_checks','pos_checkout_enabled'] LOOP
  IF OLD.program_json->key='true'::jsonb THEN
   NEW.program_json:=jsonb_set(COALESCE(NEW.program_json,'{}'::jsonb),ARRAY[key],'true'::jsonb,true);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_reward_integration_guards BEFORE UPDATE OF program_json ON businesses FOR EACH ROW EXECUTE FUNCTION app.preserve_reward_integration_guards();
