-- Keep historical v1/v2 evidence intact. Only v3 freezes an explicit channel scope.
ALTER TABLE merchant_pilots DROP CONSTRAINT merchant_pilots_checklist_version_check;
ALTER TABLE merchant_pilots
 ADD CONSTRAINT merchant_pilots_checklist_version_check CHECK(checklist_version IN(1,2,3)),
 ADD COLUMN capabilities JSONB,
 ADD CONSTRAINT merchant_pilots_capabilities_check CHECK(
  (checklist_version IN(1,2) AND capabilities IS NULL) OR
  (checklist_version=3 AND COALESCE(
   jsonb_typeof(capabilities)='object'
   AND capabilities ?& ARRAY['wallet','promotional_messaging','pos']
   AND capabilities - ARRAY['wallet','promotional_messaging','pos']='{}'::jsonb
   AND jsonb_typeof(capabilities->'wallet')='boolean'
   AND jsonb_typeof(capabilities->'promotional_messaging')='boolean'
   AND jsonb_typeof(capabilities->'pos')='boolean'
   AND (capabilities->'pos'='true'::jsonb)=(pos_profile IS NOT NULL),false))
 );
ALTER TABLE merchant_pilot_checks DROP CONSTRAINT merchant_pilot_checks_check_key_check;
ALTER TABLE merchant_pilot_checks ADD CONSTRAINT merchant_pilot_checks_check_key_check CHECK(check_key IN(
 'enrollment','phone_ownership','purchase','duplicate_receipt','redemption','refund','offline_reconnect',
 'wallet_installation','message_delivery','pos_installation',
 'fulfillment_recording','manual_recording','fulfillment_retry','fulfillment_cancellation'
));
CREATE OR REPLACE FUNCTION preserve_pilot_evidence_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.checklist_version IS DISTINCT FROM OLD.checklist_version
  OR NEW.pos_profile IS DISTINCT FROM OLD.pos_profile
  OR NEW.capabilities IS DISTINCT FROM OLD.capabilities THEN
  RAISE EXCEPTION 'Pilot checklist version, POS profile and capabilities are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
