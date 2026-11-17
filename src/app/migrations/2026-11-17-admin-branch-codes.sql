-- Branch codes identify a branch inside its business. A global constraint let one
-- tenant's code block another tenant's signup ("<slug>-main") or reveal that the
-- code exists elsewhere. No code path resolves a branch by code across tenants.
CREATE UNIQUE INDEX IF NOT EXISTS branches_business_code_key ON branches(business_id, code);
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_code_key;
