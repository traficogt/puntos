import test from "node:test";
import assert from "node:assert/strict";
import {
  alertDetail,
  auditQuery,
  auditScope,
  certificationQuery,
  correctionIssue,
  defaultCertificationPeriod,
  impersonatedBy,
  inspectable,
  isoDate,
  jobStatus,
  periodIssue,
  phoneIssue,
  pollJob,
  reasonIssue,
  severity,
} from "../src/owner-operations-model.ts";
import { automationTemplates, templateBudgetNotes, templateFormValues, templateSummary } from "../src/automation-templates.ts";

test("job polling mirrors the vanilla loop: stops on DONE or FAILED, times out after the attempts", async () => {
  const statuses = ["PENDING", "RUNNING", "DONE"];
  let reads = 0;
  const read = async () => ({ job: { status: statuses[Math.min(reads++, statuses.length - 1)], error: null } });
  const progress = [];
  assert.deepEqual(await pollJob(read, "job", { delayMs: 0, onProgress: (attempt, status) => progress.push([attempt, status]) }), { state: "done" });
  assert.deepEqual(progress, [[1, "PENDING"], [2, "RUNNING"], [3, "DONE"]]);
  assert.deepEqual(await pollJob(async () => ({ job: { status: "FAILED", error: "sin disco" } }), "job", { delayMs: 0 }), { state: "failed", error: "sin disco" });
  assert.deepEqual(await pollJob(async () => ({ job: { status: "FAILED", error: null } }), "job", { delayMs: 0 }), { state: "failed", error: "Falló el trabajo de analítica" });
  let attempts = 0;
  assert.deepEqual(await pollJob(async () => ({ job: { status: "RUNNING" } }), "job", { delayMs: 0, attempts: 4, wait: async () => { attempts++; } }), { state: "timeout" });
  assert.equal(attempts, 4);
  assert.deepEqual(jobStatus("DONE"), { label: "Completado", color: "green" });
  assert.equal(jobStatus(undefined).label, "Sin estado");
});

test("alerts flatten their per-type JSON and payments require a usable phone", () => {
  assert.equal(alertDetail(["suspicious_amount", "suspicious_points"]), "suspicious_amount, suspicious_points");
  assert.equal(alertDetail({ job_type: "pos.sync", error: "timeout", empty: null }), "job_type: pos.sync · error: timeout");
  assert.equal(alertDetail([]), "—");
  assert.equal(alertDetail(null), "—");
  assert.deepEqual(severity("HIGH"), { label: "Alta", color: "red" });
  assert.equal(phoneIssue("   "), "Escribe el teléfono del cliente.");
  assert.match(phoneIssue("12-34"), /6 dígitos/);
  assert.equal(phoneIssue("5555 1234"), null);
});

test("ledger validation follows the server schemas (uuid customer, 8–500 character reasons, ordered dates)", () => {
  const customer = "77777777-7777-4777-8777-000000000041";
  assert.match(correctionIssue("abc", "Una razón con detalle"), /identificador/);
  assert.match(correctionIssue(customer, "corta"), /8 caracteres/);
  assert.match(correctionIssue(customer, "x".repeat(501)), /500/);
  assert.equal(correctionIssue(` ${customer} `, "Una razón con detalle"), null);
  assert.match(reasonIssue("corta", "La razón del rechazo"), /^La razón del rechazo/);
  assert.equal(periodIssue("2026-11-10", "2026-11-01"), "La fecha inicial debe ser anterior o igual a la final.");
  assert.match(periodIssue("2026-1-1", ""), /completas/);
  assert.equal(periodIssue("", ""), null);
  assert.equal(certificationQuery("", ""), "");
  assert.equal(certificationQuery("2026-11-01", "2026-11-30"), "?from=2026-11-01&to=2026-11-30");
  assert.equal(isoDate(new Date("2026-11-11T03:30:00Z"), "America/Guatemala"), "2026-11-10", "the business day, not the UTC day");
  assert.deepEqual(defaultCertificationPeriod(new Date("2026-11-10T18:00:00Z"), "America/Guatemala"), { from: "2026-10-12", to: "2026-11-10" });
});

test("audit queries, scope copy and detail markers follow the vanilla filters", () => {
  assert.equal(auditQuery({ from: "", to: "", impersonatedOnly: false }, 80), "?limit=80");
  assert.equal(auditQuery({ from: "2026-11-01", to: "2026-11-10", impersonatedOnly: true }, 5000), "?limit=5000&from=2026-11-01&to=2026-11-10&impersonated_only=1");
  const day = (value) => value;
  assert.equal(auditScope({ from: "", to: "", impersonatedOnly: false }, day), "Vista actual: eventos recientes · todos los eventos visibles.");
  assert.equal(auditScope({ from: "2026-11-01", to: "", impersonatedOnly: true }, day), "Vista actual: desde 2026-11-01 · solo acciones en impersonación.");
  assert.equal(auditScope({ from: "2026-11-01", to: "2026-11-10", impersonatedOnly: false }, day), "Vista actual: del 2026-11-01 al 2026-11-10 · todos los eventos visibles.");
  assert.equal(impersonatedBy({ meta: { impersonated_by_super_admin_email: "soporte@puntosfieles.com" } }), "soporte@puntosfieles.com");
  assert.equal(impersonatedBy({ meta: {} }), null);
  assert.equal(inspectable({ meta: { gift_card_tx_id: "x" } }), true);
  assert.equal(inspectable({ meta: { fields: ["a"] } }), false);
  assert.equal(inspectable({ meta: null }), false);
});

test("templates prefill the editor without touching budgets, and flag budgets the editor will reject", () => {
  const saved = { birthday_enabled: false, birthday_points: 40, birthday_monthly_points_cap: 1200, winback_enabled: false, winback_days: 30, winback_points: 25, winback_monthly_points_cap: 30, minimum_contact_days: 14, scheduler_hour_local: 11, scheduler_tz: "America/Guatemala" };
  const strong = automationTemplates.find((template) => template.key === "reactivacion_fuerte");
  const values = templateFormValues(saved, strong);
  assert.deepEqual(values, { ...saved, birthday_enabled: true, birthday_points: 75, winback_enabled: true, winback_days: 21, winback_points: 35, scheduler_hour_local: 10 });
  assert.equal(values.winback_monthly_points_cap, 30, "the saved budget is kept for the owner to review");
  assert.equal(Object.hasOwn(values, "suspicious_digest_enabled"), false, "digest keys never enter the strict PUT /api/admin/automations payload");
  assert.deepEqual(templateBudgetNotes(values), ["El presupuesto mensual de recuperación (30 puntos) no cubre una invitación de 35 puntos."]);
  const alertsOnly = automationTemplates.find((template) => template.key === "solo_alertas");
  assert.deepEqual(templateBudgetNotes(templateFormValues(saved, alertsOnly)), [], "paused rules never fail the budget rule");
  assert.equal(templateSummary(alertsOnly), "Cumpleaños: pausado · Recuperación: pausada · Preparar a las 09:00");
  assert.equal(templateSummary(strong), "Cumpleaños: 75 puntos · Recuperación: a los 21 días, 35 puntos · Preparar a las 10:00");
  assert.deepEqual(automationTemplates.map((template) => template.key), ["cafeteria_basico", "reactivacion_fuerte", "solo_alertas"]);
});
