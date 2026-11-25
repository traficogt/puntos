import test from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL_FILTERS,
  filterTrialRows,
  hasTrialColumns,
  signupSourceLabel,
  trialCounts,
  trialDatesLine,
  trialDaysLeft,
  trialPhoneLabel,
  trialStatusLabel,
} from "../../public/super/trials-model.js";

const now = new Date("2026-11-25T15:00:00Z");
const day = (offset) => new Date(now.getTime() + offset * 86_400_000).toISOString();
/** @type {import("../../public/super/types.js").SuperBusinessRow[]} */
const rows = [
  {
    id: "a",
    name: "Activa",
    plan: "EMPRENDEDOR",
    signup_source: "self_serve",
    trial_status: "active",
    trial_started_at: day(-5),
    trial_ends_at: day(9),
    trial_phone: "50255551234",
    billing_status: "trialing",
  },
  {
    id: "b",
    name: "Por vencer",
    plan: "EMPRENDEDOR",
    signup_source: "self_serve",
    trial_status: "active",
    trial_started_at: day(-12),
    trial_ends_at: day(2),
    trial_phone: "50299998888",
    billing_status: "trialing",
  },
  {
    id: "c",
    name: "Bloqueada",
    plan: "EMPRENDEDOR",
    signup_source: "self_serve",
    trial_status: "expired",
    trial_ends_at: day(-3),
    trial_phone: "50211112222",
    billing_status: "locked",
    locked_at: day(-3),
    purge_after: day(27),
  },
  {
    id: "d",
    name: "Convertida",
    plan: "NEGOCIO",
    signup_source: "self_serve",
    trial_status: "converted",
    trial_ends_at: day(-20),
    trial_phone: "50233334444",
    billing_status: "active",
  },
  {
    id: "e",
    name: "Interna",
    plan: "NEGOCIO",
    signup_source: "internal",
    trial_status: "none",
    billing_status: "none",
  },
];

test("legacy servers without trial columns are detected so the section can explain itself", () => {
  assert.equal(hasTrialColumns([{ id: "x", name: "Old", plan: "EMPRENDEDOR" }]), false);
  assert.equal(hasTrialColumns(rows), true);
});

test("filters match the design's chips and sort by the soonest trial end", () => {
  assert.deepEqual(
    TRIAL_FILTERS.map(([key]) => key),
    ["all", "active", "ending", "locked", "converted", "purge"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "all", now).map((r) => r.id),
    ["d", "c", "b", "a"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "active", now).map((r) => r.id),
    ["b", "a"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "ending", now).map((r) => r.id),
    ["b"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "locked", now).map((r) => r.id),
    ["c"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "converted", now).map((r) => r.id),
    ["d"],
  );
  assert.deepEqual(
    filterTrialRows(rows, "purge", now).map((r) => r.id),
    ["c"],
  );
  assert.deepEqual(trialCounts(rows, now), {
    all: 4,
    active: 2,
    ending: 1,
    locked: 1,
    converted: 1,
    purge: 1,
  });
});

test("days left, labels and dates read the row without inventing data", () => {
  assert.equal(trialDaysLeft(rows[0], now), 9);
  assert.equal(trialDaysLeft(rows[2], now), 0, "never negative");
  assert.equal(trialDaysLeft(rows[4], now), null);
  assert.equal(trialStatusLabel(rows[0]), "En prueba");
  assert.equal(trialStatusLabel(rows[2]), "Bloqueada");
  assert.equal(trialStatusLabel(rows[3]), "Convertida");
  assert.equal(trialStatusLabel(rows[4]), "Sin prueba");
  assert.equal(
    trialStatusLabel({
      id: "f",
      name: "",
      plan: "",
      trial_status: "active",
      billing_status: "past_due",
    }),
    "Pago pendiente",
  );
  assert.equal(trialPhoneLabel(rows[0]), "Teléfono verificado · ···1234");
  assert.equal(trialPhoneLabel(rows[4]), "Teléfono sin verificar");
  assert.equal(signupSourceLabel("self_serve"), "Autoservicio (/prueba/)");
  assert.equal(signupSourceLabel(undefined), "Origen no registrado");
  const line = trialDatesLine(rows[2], now);
  assert.match(line, /Fin /);
  assert.match(line, /Bloqueo /);
  assert.match(line, /Eliminación .* \(27 días\)/);
  assert.match(trialDatesLine(rows[0], now), /\(9 días\)/);
  assert.equal(trialDatesLine(rows[4], now), "");
});
