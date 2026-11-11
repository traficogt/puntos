CREATE TABLE IF NOT EXISTS merchant_pilots (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 duration_days INTEGER NOT NULL CHECK(duration_days IN(14,30,60)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','completed','stopped')),
 started_at TIMESTAMPTZ NOT NULL,
 planned_end_at TIMESTAMPTZ NOT NULL,
 closed_at TIMESTAMPTZ,
 close_note TEXT NOT NULL DEFAULT '' CHECK(length(close_note)<=500),
 created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
 UNIQUE(business_id,id), UNIQUE(business_id,request_id),
 CHECK(planned_end_at>started_at),
 CHECK((status='active')=(closed_at IS NULL)),
 CHECK(closed_at IS NULL OR closed_at>=started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_pilots_one_active ON merchant_pilots(business_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS merchant_pilots_history ON merchant_pilots(business_id,started_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS merchant_pilot_checks (
 business_id UUID NOT NULL,
 pilot_id UUID NOT NULL,
 check_key TEXT NOT NULL CHECK(check_key IN('enrollment','purchase','duplicate_receipt','redemption','refund','offline_reconnect','wallet_installation','message_delivery','pos_installation')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','passed','failed','not_applicable')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
 updated_at TIMESTAMPTZ,
 updated_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
 PRIMARY KEY(business_id,pilot_id,check_key),
 FOREIGN KEY(business_id,pilot_id) REFERENCES merchant_pilots(business_id,id) ON DELETE CASCADE,
 CHECK(status!='not_applicable' OR check_key IN('wallet_installation','message_delivery','pos_installation')),
 CHECK(status='pending' OR length(btrim(note))>0)
);
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_pilots','merchant_pilot_checks'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r);END IF;
  END LOOP;
 END LOOP;
END $$;
