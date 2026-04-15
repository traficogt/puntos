-- Forward-only hardening: prevent raw SQL paths from persisting untrimmed identifier values.
DO $$
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    ALTER TABLE contact_identifiers
      ADD CONSTRAINT contact_identifiers_identifier_value_trimmed_chk
      CHECK (
        identifier_value = regexp_replace(
          identifier_value,
          '^[[:space:]]+|[[:space:]]+$',
          '',
          'g'
        )
      ) NOT VALID;

    UPDATE contact_identifiers
       SET identifier_value = regexp_replace(
         identifier_value,
         '^[[:space:]]+|[[:space:]]+$',
         '',
         'g'
       )
     WHERE identifier_value IS NOT NULL
       AND identifier_value <> regexp_replace(
         identifier_value,
         '^[[:space:]]+|[[:space:]]+$',
         '',
         'g'
       );

    ALTER TABLE contact_identifiers
      VALIDATE CONSTRAINT contact_identifiers_identifier_value_trimmed_chk;
  END IF;
END$$;
