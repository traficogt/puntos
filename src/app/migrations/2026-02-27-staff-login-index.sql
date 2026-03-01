-- Cross-tenant staff email lookup for login, without weakening staff_users RLS.
-- Maintained via trigger so the runtime role doesn't need broad reads.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS staff_login_index (
  email TEXT PRIMARY KEY,
  staff_user_id UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_login_index_business ON staff_login_index (business_id);

-- Keep the index case-insensitive; staff_users.email is historically case-sensitive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_email_lower_unique
  ON staff_users (lower(email))
  WHERE email IS NOT NULL;

-- Backfill / reconcile.
INSERT INTO staff_login_index (email, staff_user_id, business_id, branch_id, name, role, password_hash, active, updated_at)
SELECT
  lower(email) AS email,
  id AS staff_user_id,
  business_id,
  branch_id,
  name,
  role,
  password_hash,
  active,
  now()
FROM staff_users
WHERE email IS NOT NULL
ON CONFLICT (email) DO UPDATE
SET staff_user_id = EXCLUDED.staff_user_id,
    business_id = EXCLUDED.business_id,
    branch_id = EXCLUDED.branch_id,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    password_hash = EXCLUDED.password_hash,
    active = EXCLUDED.active,
    updated_at = now();

CREATE OR REPLACE FUNCTION app.sync_staff_login_index()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  old_email TEXT;
  new_email TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.email IS NOT NULL THEN
      DELETE FROM staff_login_index WHERE email = lower(OLD.email);
    END IF;
    RETURN OLD;
  END IF;

  old_email := CASE WHEN TG_OP = 'UPDATE' AND OLD.email IS NOT NULL THEN lower(OLD.email) ELSE NULL END;
  new_email := CASE WHEN NEW.email IS NOT NULL THEN lower(NEW.email) ELSE NULL END;

  IF old_email IS NOT NULL AND (new_email IS NULL OR new_email <> old_email) THEN
    DELETE FROM staff_login_index WHERE email = old_email;
  END IF;

  IF new_email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO staff_login_index (email, staff_user_id, business_id, branch_id, name, role, password_hash, active, updated_at)
  VALUES (new_email, NEW.id, NEW.business_id, NEW.branch_id, NEW.name, NEW.role, NEW.password_hash, NEW.active, now())
  ON CONFLICT (email) DO UPDATE
  SET staff_user_id = EXCLUDED.staff_user_id,
      business_id = EXCLUDED.business_id,
      branch_id = EXCLUDED.branch_id,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      password_hash = EXCLUDED.password_hash,
      active = EXCLUDED.active,
      updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_staff_login_index ON staff_users;
CREATE TRIGGER trg_sync_staff_login_index
AFTER INSERT OR UPDATE OR DELETE ON staff_users
FOR EACH ROW EXECUTE PROCEDURE app.sync_staff_login_index();

