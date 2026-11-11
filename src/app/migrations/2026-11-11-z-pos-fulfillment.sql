-- POS evidence is independent of loyalty entitlement and inventory ownership.
CREATE TABLE reward_pos_mappings (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE CASCADE, branch_id uuid REFERENCES branches(id),
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 180), product_ref text NOT NULL CHECK(length(product_ref) BETWEEN 1 AND 200),
 item_name text NOT NULL CHECK(length(item_name) BETWEEN 1 AND 150), item_kind text NOT NULL CHECK(item_kind IN('product','service')),
 quantity numeric(18,6) NOT NULL CHECK(quantity>0 AND quantity<=1000000), enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,reward_id,source)
);
CREATE TABLE redemption_pos_records (
 redemption_id uuid PRIMARY KEY REFERENCES redemptions(id) ON DELETE CASCADE,
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, branch_id uuid REFERENCES branches(id),
 reward_id uuid NOT NULL REFERENCES rewards(id), reward_name text NOT NULL, currency text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','recorded','not_required','review','reviewed')),
 method text CHECK(method IN('manual','connector')), version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 source text, order_id text, line_id text, original_event_id text, mapping_snapshot jsonb,
 stock_status text NOT NULL DEFAULT 'unknown' CHECK(stock_status IN('unknown','pending','done','not_applicable','returned')),
 returned_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(returned_quantity>=0), receipt_ref text,
 recorded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,source,line_id)
);
CREATE TABLE redemption_pos_events (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 redemption_id uuid NOT NULL REFERENCES redemptions(id) ON DELETE CASCADE,
 source text NOT NULL, event_id text NOT NULL, fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN('recorded','not_required','review','reviewed','reversed','stock_updated')),
 actor_staff_id uuid REFERENCES staff_users(id), line_id text, details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,source,event_id)
);
CREATE UNIQUE INDEX redemption_pos_receipt_line ON redemption_pos_events(business_id,source,line_id) WHERE kind IN('recorded','reversed');
CREATE INDEX redemption_pos_pending ON redemption_pos_records(business_id,status,created_at DESC,redemption_id DESC);
CREATE INDEX redemption_pos_event_history ON redemption_pos_events(business_id,redemption_id,created_at,id);
CREATE OR REPLACE FUNCTION app.capture_redemption_pos_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='REDEEMED' THEN
  INSERT INTO redemption_pos_records(redemption_id,business_id,branch_id,reward_id,reward_name,currency)
  SELECT NEW.id,NEW.business_id,NEW.branch_id,NEW.reward_id,w.name,COALESCE(b.program_json#>>'{region,currency}','GTQ')
  FROM rewards w JOIN businesses b ON b.id=NEW.business_id WHERE w.id=NEW.reward_id AND w.business_id=NEW.business_id
  ON CONFLICT(redemption_id) DO NOTHING;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER redemption_pos_capture AFTER INSERT OR UPDATE OF status ON redemptions FOR EACH ROW EXECUTE FUNCTION app.capture_redemption_pos_record();
CREATE OR REPLACE FUNCTION app.flag_restored_redemption_pos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE redemption_pos_records SET status='review',version=version+1,updated_at=now()
 WHERE business_id=NEW.business_id AND redemption_id=NEW.redemption_id;
 RETURN NEW;
END $$;
CREATE TRIGGER redemption_pos_restoration_review AFTER INSERT ON service_redemption_restorations FOR EACH ROW EXECUTE FUNCTION app.flag_restored_redemption_pos();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['reward_pos_mappings','redemption_pos_records','redemption_pos_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.flag_reversed_redemption_pos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source='redeem' AND NEW.reversed_transaction_id IS NOT NULL AND OLD.reversed_transaction_id IS DISTINCT FROM NEW.reversed_transaction_id THEN
  UPDATE redemption_pos_records SET status='review',version=version+1,updated_at=now()
  WHERE business_id=NEW.business_id AND redemption_id::text=NEW.meta->>'redemption_id';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER redemption_pos_debit_reversal AFTER UPDATE OF reversed_transaction_id ON transactions FOR EACH ROW EXECUTE FUNCTION app.flag_reversed_redemption_pos();
-- Existing runtime redemption writers need trigger privileges immediately at migration commit.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='redemptions' AND privilege_type='INSERT' AND grantee<>'PUBLIC' LOOP
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON reward_pos_mappings,redemption_pos_records TO %I',r.grantee);
  EXECUTE format('GRANT SELECT,INSERT ON redemption_pos_events TO %I',r.grantee);
 END LOOP;
END $$;
