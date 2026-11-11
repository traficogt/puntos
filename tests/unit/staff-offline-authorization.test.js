import test from "node:test";
import assert from "node:assert/strict";
import { signQrToken, verifyQrToken } from "../../src/utils/qr-token.js";
import { issueOfflineGrant, verifyCapturedQr } from "../../src/app/services/staff-offline-service.js";

const staff = { id: "staff-1", business_id: "business-1" };

test("a valid staff grant permits a late upload of a QR valid at capture", async () => {
  const originalNow = new Date();
  const grant = await issueOfflineGrant(staff, { now: originalNow });
  const qr = await signQrToken(staff.business_id, "customer-1", 60);
  const later = new Date(originalNow.getTime() + 3600000);
  await assert.rejects(verifyQrToken(qr.token, { currentDate: later }), /exp/);
  const decoded = await verifyCapturedQr({ token: qr.token, grant: grant.grant, staff, capturedAt: new Date().toISOString(), now: later });
  assert.equal(decoded.cid, "customer-1");
});

test("offline authorization is bound to staff and business", async () => {
  const originalNow = new Date();
  const grant = await issueOfflineGrant(staff, { now: originalNow });
  const qr = await signQrToken(staff.business_id, "customer-1", 60);
  for (const changed of [{ ...staff, id: "another-staff" }, { ...staff, business_id: "another-business" }]) {
    await assert.rejects(verifyCapturedQr({ token: qr.token, grant: grant.grant, staff: changed, capturedAt: originalNow.toISOString(), now: originalNow }), { statusCode: 403 });
  }
});

test("expired-at-capture, future capture, stale grants and tampered tokens cannot award", async () => {
  const originalNow = new Date();
  const grant = await issueOfflineGrant(staff, { now: originalNow });
  const qr = await signQrToken(staff.business_id, "customer-1", 60);
  const base = { token: qr.token, grant: grant.grant, staff, capturedAt: originalNow.toISOString(), now: new Date(originalNow.getTime() + 3600000) };
  for (const patch of [
    { capturedAt: new Date(originalNow.getTime() + 120000).toISOString() },
    { capturedAt: new Date(originalNow.getTime() + 7200000).toISOString() },
    { now: new Date(originalNow.getTime() + 25 * 3600000) },
    { capturedAt: "not-a-date" }, { grant: "wrong" }, { token: qr.token.slice(0, -8) + "tampered" }
  ]) await assert.rejects(verifyCapturedQr({ ...base, ...patch }));
});

test("a customer QR cannot be used as a staff offline grant", async () => {
  const originalNow = new Date();
  const qr = await signQrToken(staff.business_id, "customer-1", 60);
  await assert.rejects(verifyCapturedQr({ token: qr.token, grant: qr.token, staff, capturedAt: originalNow.toISOString(), now: originalNow }));
});
