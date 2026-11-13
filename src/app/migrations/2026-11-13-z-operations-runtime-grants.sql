-- Normalize runtime grants on the new operations tables after legacy default ACLs.
-- GRANT alone does not remove privileges supplied by ALTER DEFAULT PRIVILEGES.
-- Leave the migration/table owner intact; restrict only non-owner runtime roles.
DO $$
DECLARE
 t text;
 r text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'merchant_decision_events','issued_commitment_values','operating_offer_templates',
  'operating_template_runs','operating_mode_changes',
  'demand_topics','demand_requests','demand_request_receipts','demand_events',
  'supplier_agreements','supplier_claims','supplier_claim_events',
  'staff_auto_briefings','staff_auto_briefing_acknowledgements','reward_promise_extensions',
  'staff_rehearsals','staff_rehearsal_events',
  'ingestion_health_events','transaction_evidence_events','redemption_evidence_events'
 ] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(
    SELECT 1 FROM pg_roles role JOIN pg_class relation ON relation.oid=to_regclass(format('public.%I',t))
    WHERE role.rolname=r AND role.oid<>relation.relowner
   ) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);
    EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO %I',t,r);
    IF t=ANY(ARRAY['operating_offer_templates','demand_topics','supplier_agreements','supplier_claims','staff_rehearsals']) THEN
     EXECUTE format('GRANT UPDATE ON TABLE public.%I TO %I',t,r);
    END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
