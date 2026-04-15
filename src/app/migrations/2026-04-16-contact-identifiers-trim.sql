-- Forward-only hardening: prevent raw SQL paths from persisting untrimmed identifier values.
DO $$
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    ALTER TABLE contact_identifiers
      ADD CONSTRAINT contact_identifiers_identifier_value_trimmed_chk
      CHECK (identifier_value = btrim(identifier_value));
  END IF;
END$$;
