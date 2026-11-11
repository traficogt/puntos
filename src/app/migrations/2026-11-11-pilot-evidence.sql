-- Existing pilot evidence retains its original checklist, including closed history.
ALTER TABLE merchant_pilots
 ADD COLUMN checklist_version INTEGER NOT NULL DEFAULT 1 CHECK(checklist_version IN(1,2)),
 ADD COLUMN pos_profile JSONB CHECK(pos_profile IS NULL OR (jsonb_typeof(pos_profile)='object' AND octet_length(pos_profile::text)<=1500));
ALTER TABLE merchant_pilot_checks DROP CONSTRAINT merchant_pilot_checks_check_key_check;
ALTER TABLE merchant_pilot_checks ADD CONSTRAINT merchant_pilot_checks_check_key_check CHECK(check_key IN(
 'enrollment','purchase','duplicate_receipt','redemption','refund','offline_reconnect','wallet_installation','message_delivery','pos_installation',
 'fulfillment_recording','manual_recording','fulfillment_retry','fulfillment_cancellation'
));
CREATE FUNCTION preserve_pilot_evidence_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.checklist_version IS DISTINCT FROM OLD.checklist_version OR NEW.pos_profile IS DISTINCT FROM OLD.pos_profile THEN
  RAISE EXCEPTION 'Pilot checklist version and POS profile are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER merchant_pilot_evidence_profile_immutable BEFORE UPDATE ON merchant_pilots
 FOR EACH ROW EXECUTE FUNCTION preserve_pilot_evidence_profile();
