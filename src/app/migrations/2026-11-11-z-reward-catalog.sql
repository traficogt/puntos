-- Vendor-neutral catalog metadata and observed stock; never a physical inventory ledger.
CREATE TABLE merchant_catalog_items (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 180), product_ref text NOT NULL CHECK(length(product_ref) BETWEEN 1 AND 200),
 sku text CHECK(length(sku) BETWEEN 1 AND 100), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
 item_kind text NOT NULL CHECK(item_kind IN('product','service')), active boolean NOT NULL,
 origin text NOT NULL CHECK(origin IN('manual','csv','connector')), revision integer NOT NULL CHECK(revision>0),
 observed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,source,product_ref),
 CHECK((origin='manual' AND source='catalog:manual') OR (origin='csv' AND source='catalog:csv') OR (origin='connector' AND source NOT IN('catalog:manual','catalog:csv','manual','system')))
);
CREATE INDEX merchant_catalog_search ON merchant_catalog_items(business_id,name,id);
CREATE TABLE merchant_catalog_sources (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 source text NOT NULL, scope text NOT NULL CHECK(scope IN('catalog','inventory')), branch_id uuid REFERENCES branches(id),
 origin text NOT NULL CHECK(origin IN('manual','csv','connector')), observed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope='catalog' AND branch_id IS NULL) OR (scope='inventory' AND branch_id IS NOT NULL AND origin='connector'))
);
CREATE UNIQUE INDEX merchant_catalog_source_scope ON merchant_catalog_sources(business_id,source,scope,COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE merchant_inventory_snapshots (
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, source text NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id), product_ref text NOT NULL,
 available_quantity numeric(18,6) CHECK(available_quantity>=0 AND available_quantity<=1000000000), observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,source,branch_id,product_ref), FOREIGN KEY(business_id,source,product_ref) REFERENCES merchant_catalog_items(business_id,source,product_ref)
);
CREATE TABLE merchant_catalog_events (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, source text NOT NULL, request_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN('manual','csv','catalog','inventory')), fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 actor_staff_id uuid REFERENCES staff_users(id), observed_at timestamptz, details jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,source,request_id)
);
ALTER TABLE reward_pos_mappings ADD COLUMN inventory_required boolean NOT NULL DEFAULT false;
ALTER TABLE reward_pos_mappings ADD CONSTRAINT reward_inventory_product_branch CHECK(NOT inventory_required OR (item_kind='product' AND branch_id IS NOT NULL));
CREATE UNIQUE INDEX reward_inventory_one_mapping ON reward_pos_mappings(business_id,reward_id,branch_id) WHERE enabled AND inventory_required;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_catalog_items','merchant_catalog_sources','merchant_inventory_snapshots','merchant_catalog_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 END LOOP;
END $$;
