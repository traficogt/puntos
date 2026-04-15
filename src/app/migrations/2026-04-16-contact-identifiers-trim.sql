-- Forward-only hardening: prevent raw SQL paths from persisting untrimmed identifier values.
DO $$
DECLARE
  conflict_business_id UUID;
  conflict_identifier_type TEXT;
  conflict_identifier_value TEXT;
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    SELECT business_id, identifier_type, normalized_value
      INTO conflict_business_id, conflict_identifier_type, conflict_identifier_value
      FROM (
        SELECT
          business_id,
          identifier_type,
          regexp_replace(
            identifier_value,
            '^[[:space:]]+|[[:space:]]+$',
            '',
            'g'
          ) AS normalized_value,
          COUNT(DISTINCT customer_id) AS customer_count
        FROM contact_identifiers
        GROUP BY business_id, identifier_type, normalized_value
        HAVING COUNT(DISTINCT customer_id) > 1
      ) conflicts
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'contact_identifiers trim migration aborted: normalized value collision across customers for business_id=%, identifier_type=%, identifier_value=%',
        conflict_business_id,
        conflict_identifier_type,
        conflict_identifier_value;
    END IF;

    WITH ranked_identifiers AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY
            business_id,
            identifier_type,
            customer_id,
            regexp_replace(
              identifier_value,
              '^[[:space:]]+|[[:space:]]+$',
              '',
              'g'
            )
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM contact_identifiers
    )
    DELETE FROM contact_identifiers
    USING ranked_identifiers
    WHERE contact_identifiers.id = ranked_identifiers.id
      AND ranked_identifiers.rn > 1;

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
