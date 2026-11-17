-- Payment provider event IDs are unique per merchant account, not across PF.
-- The global UNIQUE (provider, provider_event_id) made a second business's
-- event with the same ID fail permanently, and let one business take over
-- another's unmapped row. Deduplicate per destination instead:
-- * mapped rows by business (its slug is fixed for that business);
-- * unmapped rows (business_id NULL) by the slug the payload addressed, with
--   a missing slug as its own NULL group.
-- Keeping business_slug in the key also lets ON DELETE SET NULL on business_id
-- leave a deleted business's rows distinct from other unmapped rows.
-- The new index is implied by the old constraint, so it builds on live data.
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_destination_event_key
  ON payment_webhook_events (provider, business_id, business_slug, provider_event_id) NULLS NOT DISTINCT;

DO $$
DECLARE
  legacy record;
BEGIN
  FOR legacy IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'payment_webhook_events'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['provider', 'provider_event_id']
  LOOP
    EXECUTE format('ALTER TABLE payment_webhook_events DROP CONSTRAINT %I', legacy.conname);
  END LOOP;
END$$;

-- Ingest mode with a tenant set can satisfy both the unmapped-row and tenant
-- policies, which together would let a session move an unmapped row into a
-- business. Rows keep their business; only platform operators may reassign
-- one. Clearing it (ON DELETE SET NULL) remains possible.
CREATE OR REPLACE FUNCTION app.payment_webhook_event_keep_business() RETURNS trigger AS $$
BEGIN
  IF NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM OLD.business_id AND NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'payment webhook events cannot move to another business' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_webhook_event_keep_business ON payment_webhook_events;
CREATE TRIGGER trg_payment_webhook_event_keep_business
  BEFORE UPDATE OF business_id ON payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION app.payment_webhook_event_keep_business();
