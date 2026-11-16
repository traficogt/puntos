-- Public support uses an unguessable capability, independent of tenant membership.
CREATE TABLE IF NOT EXISTS support_cases (
 id uuid PRIMARY KEY, reference text NOT NULL UNIQUE,
 request_id uuid NOT NULL UNIQUE, request_fingerprint text NOT NULL,
 tracking_hash text NOT NULL UNIQUE CHECK(length(tracking_hash)=64),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 email text NOT NULL CHECK(length(email)<=254),
 business_label text NOT NULL DEFAULT '' CHECK(length(business_label)<=160),
 business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
 actor_type text CHECK(actor_type IN ('STAFF','CUSTOMER')), actor_id uuid,
 category text NOT NULL CHECK(category IN ('access','points','reward','scan','business','privacy','other')),
 description text NOT NULL CHECK(length(description) BETWEEN 15 AND 4000),
 diagnostics jsonb, status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','open','waiting','resolved','closed')),
 assigned_to text CHECK(length(assigned_to)<=254), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS support_case_events (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, request_fingerprint text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('created','customer','response','note','updated')),
 visibility text NOT NULL CHECK(visibility IN ('public','internal')),
 message text NOT NULL DEFAULT '' CHECK(length(message)<=4000), actor_email text,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,request_id)
);
CREATE TABLE IF NOT EXISTS support_case_attachments (
 id uuid PRIMARY KEY, case_id uuid NOT NULL UNIQUE REFERENCES support_cases(id) ON DELETE CASCADE,
 content_type text NOT NULL CHECK(content_type='image/webp'),
 data bytea NOT NULL CHECK(octet_length(data)<=614400),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 4096),height integer NOT NULL CHECK(height BETWEEN 1 AND 4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days'
);
CREATE INDEX IF NOT EXISTS support_cases_queue_idx ON support_cases(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS support_case_events_case_idx ON support_case_events(case_id,created_at);
ALTER TABLE support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE support_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_case_events FORCE ROW LEVEL SECURITY;
ALTER TABLE support_case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_case_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_case_scope ON support_cases;
CREATE POLICY support_case_scope ON support_cases USING (
 current_setting('app.platform_admin',true)='true' OR tracking_hash=nullif(current_setting('app.support_hash',true),'')
) WITH CHECK (current_setting('app.platform_admin',true)='true' OR tracking_hash=nullif(current_setting('app.support_hash',true),''));
DROP POLICY IF EXISTS support_event_read ON support_case_events;
CREATE POLICY support_event_read ON support_case_events FOR SELECT USING (
 current_setting('app.platform_admin',true)='true' OR (visibility='public' AND EXISTS(SELECT 1 FROM support_cases c WHERE c.id=case_id))
);
DROP POLICY IF EXISTS support_event_insert ON support_case_events;
CREATE POLICY support_event_insert ON support_case_events FOR INSERT WITH CHECK (
 current_setting('app.platform_admin',true)='true' OR (visibility='public' AND kind IN ('created','customer') AND actor_email IS NULL AND EXISTS(SELECT 1 FROM support_cases c WHERE c.id=case_id))
);
DROP POLICY IF EXISTS support_attachment_scope ON support_case_attachments;
CREATE POLICY support_attachment_scope ON support_case_attachments FOR SELECT USING (EXISTS(SELECT 1 FROM support_cases c WHERE c.id=case_id));
DROP POLICY IF EXISTS support_attachment_insert ON support_case_attachments;
CREATE POLICY support_attachment_insert ON support_case_attachments FOR INSERT WITH CHECK (EXISTS(SELECT 1 FROM support_cases c WHERE c.id=case_id));
DROP POLICY IF EXISTS support_attachment_purge ON support_case_attachments;
CREATE POLICY support_attachment_purge ON support_case_attachments FOR DELETE USING (current_setting('app.platform_admin',true)='true' AND expires_at<=clock_timestamp());
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['support_cases','support_case_events','support_case_attachments'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles p JOIN pg_class c ON c.oid=to_regclass(format('public.%I',t)) WHERE p.rolname=r AND p.oid<>c.relowner) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);
    EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO %I',t,r);
    IF t='support_case_attachments' THEN EXECUTE format('GRANT DELETE ON TABLE public.%I TO %I',t,r); END IF;
    IF t='support_cases' THEN EXECUTE format('GRANT UPDATE(status,assigned_to,version,updated_at) ON TABLE public.%I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
