import test from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo-api.js";
import { createOwnerOperationsDemoApi } from "../src/demo-owner-operations.ts";

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

test("operations screens have preview data and never reach fetch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected network");
  };
  try {
    assert.equal((await demoApi("/api/admin/plan")).features.analytics, true, "the demo plan unlocks the operations pages");
    const jobs = await demoApi("/api/admin/jobs?limit=12");
    assert.ok(jobs.jobs.length >= 3);
    assert.ok(jobs.jobs.some((job) => job.status === "FAILED" && job.error));
    const payments = await demoApi("/api/admin/payment-webhooks?status=PENDING_MAPPING&limit=20");
    assert.ok(payments.events.length >= 1);
    assert.ok(payments.events.every((event) => event.status === "PENDING_MAPPING"));
    const alerts = await demoApi("/api/admin/alerts?limit=60");
    assert.ok(alerts.alerts.length >= 3);
    for (const type of ["suspicious_award", "job_failed", "payment_webhook_issue"]) assert.ok(alerts.alerts.some((row) => row.alert_type === type), type);
    const anomalies = await demoApi("/api/admin/analytics/anomalies");
    assert.equal(typeof anomalies.summary.negative_balance_count, "number");
    const reconciliation = await demoApi("/api/admin/analytics/ledger-reconciliation");
    assert.ok(reconciliation.latest_run?.completed_at);
    assert.ok(reconciliation.latest_findings.some((row) => row.repaired === false));
    const certification = await demoApi("/api/admin/analytics/ledger-certification?from=2026-11-01&to=2026-11-10");
    assert.deepEqual(certification.period, { from: "2026-11-01", to: "2026-11-10" });
    assert.equal(certification.daily_rows.length, 10);
    assert.equal(certification.summary.points_issued, certification.daily_rows.reduce((sum, row) => sum + row.points_issued, 0));
    assert.equal(certification.certification_status, "REVIEW_REQUIRED", "pending corrections and a negative balance keep the period under review");
    assert.ok((await demoApi("/api/admin/analytics/ledger-certification/archive")).available_days.length >= 1);
    const corrections = await demoApi("/api/admin/analytics/ledger-corrections?limit=50");
    assert.ok(corrections.corrections.some((row) => row.status === "PENDING"));
    const audit = await demoApi("/api/admin/audit?limit=80");
    assert.ok(audit.events.length >= 5);
    const impersonated = await demoApi("/api/admin/audit?limit=80&impersonated_only=1");
    assert.ok(impersonated.events.length >= 1);
    assert.ok(impersonated.events.every((event) => event.meta?.impersonated_by_super_admin_email));
    assert.ok(audit.events.length > impersonated.events.length);
    await assert.rejects(demoApi("/api/admin/audit.csv?limit=5000"), /demostración/, "CSV downloads are not part of the preview");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("a queued recalculation advances through the polls the screen performs", () => {
  const api = createOwnerOperationsDemoApi();
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const before = call("/api/admin/jobs").jobs.length;
  const queued = call("/api/admin/analytics/calculate", { method: "POST", body: "{}" });
  assert.equal(queued.job.status, "PENDING");
  assert.equal(call("/api/admin/jobs").jobs.length, before + 1);
  assert.equal(call(`/api/admin/jobs/${queued.job.id}`).job.status, "RUNNING");
  assert.equal(call(`/api/admin/jobs/${queued.job.id}`).job.status, "DONE");
  assert.equal(call(`/api/admin/jobs/${queued.job.id}`).job.status, "DONE", "a finished job stays finished");
  assert.throws(() => call("/api/admin/jobs/77777777-7777-4777-8777-999999999999"), /no encontrada/);
});

test("assigning a pending payment needs a phone and removes it from the pending list and the alerts", () => {
  const api = createOwnerOperationsDemoApi();
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const [event] = call("/api/admin/payment-webhooks?status=PENDING_MAPPING").events;
  assert.throws(() => call(`/api/admin/payment-webhooks/${event.id}/resolve`, post({})), /required/);
  assert.throws(() => call(`/api/admin/payment-webhooks/${event.id}/resolve`, post({ customerPhone: "123" })), /at least 6/);
  const resolved = call(`/api/admin/payment-webhooks/${event.id}/resolve`, post({ customerPhone: "55551234" }));
  assert.equal(resolved.ok, true);
  assert.ok(resolved.transactionId);
  assert.equal(call("/api/admin/payment-webhooks?status=PENDING_MAPPING").events.some((row) => row.id === event.id), false);
  assert.equal(call("/api/admin/alerts").alerts.some((row) => row.id === event.id), false, "the payment alert disappears once assigned");
  assert.throws(() => call(`/api/admin/payment-webhooks/${event.id}/resolve`, post({ customerPhone: "55551234" })), /ya fue asignado/);
});

test("ledger corrections follow request → apply/reject with the server's validation rules", () => {
  const api = createOwnerOperationsDemoApi();
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const customerId = "77777777-7777-4777-8777-000000000041";
  assert.throws(() => call("/api/admin/analytics/ledger-corrections", post({ customerId: "not-a-uuid", reason: "Razón suficientemente larga" })), /identificador/);
  assert.throws(() => call("/api/admin/analytics/ledger-corrections", post({ customerId, reason: "corta" })), /8 a 500/);
  const { correction } = call("/api/admin/analytics/ledger-corrections", post({ customerId, reason: "Descuadre revisado con el cliente en caja." }));
  assert.equal(correction.status, "PENDING");
  assert.equal(correction.requested_stored_points, 420, "the request copies the reconciliation finding for that customer");
  assert.equal(correction.requested_expected_points, 380);
  const pendingBefore = call("/api/admin/analytics/anomalies").summary.pending_corrections_count;
  assert.throws(() => call(`/api/admin/analytics/ledger-corrections/${correction.id}/reject`, post({ reason: "corta" })), /8 y 500/);
  const rejected = call(`/api/admin/analytics/ledger-corrections/${correction.id}/reject`, post({ reason: "El cliente ya fue compensado manualmente." }));
  assert.equal(rejected.correction.status, "REJECTED");
  assert.equal(call("/api/admin/analytics/anomalies").summary.pending_corrections_count, pendingBefore - 1);
  assert.throws(() => call(`/api/admin/analytics/ledger-corrections/${correction.id}/apply`, post({})), /ya fue resuelta/);
  const pending = call("/api/admin/analytics/ledger-corrections").corrections.find((row) => row.status === "PENDING");
  const applied = call(`/api/admin/analytics/ledger-corrections/${pending.id}/apply`, post({}));
  assert.equal(applied.correction.status, "APPLIED");
  assert.equal(call("/api/admin/analytics/ledger-corrections").corrections.find((row) => row.id === pending.id).status, "APPLIED");
});

test("audit filters by date and impersonation, and details link the records the event names", () => {
  const api = createOwnerOperationsDemoApi();
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const all = call("/api/admin/audit?limit=80").events;
  const ranged = call("/api/admin/audit?limit=80&from=2026-11-10&to=2026-11-10").events;
  assert.ok(ranged.length > 0 && ranged.length < all.length);
  assert.ok(ranged.every((event) => event.created_at.startsWith("2026-11-10")));
  assert.equal(call("/api/admin/audit?limit=2").events.length, 2);
  const refund = all.find((event) => event.action === "award.refund");
  const detail = call(`/api/admin/audit/${refund.id}`);
  assert.equal(detail.event.id, refund.id);
  assert.ok(detail.linked.transaction?.customer_name);
  assert.equal(detail.linked.reversal_transaction?.reversal_reason, "Devolución en caja");
  const plan = all.find((event) => event.action === "platform.plan.update");
  assert.deepEqual(call(`/api/admin/audit/${plan.id}`).linked, {}, "platform events carry no linked records");
  assert.throws(() => call("/api/admin/audit/77777777-7777-4777-8777-999999999999"), /no encontrado/);
  assert.equal(call("/api/admin/unknown-operations-endpoint"), undefined);
});
