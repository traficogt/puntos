import { modalConfirm, modalPrompt } from "/lib.js";
import {
  TRIAL_FILTERS,
  filterTrialRows,
  hasTrialColumns,
  signupSourceLabel,
  trialCounts,
  trialDatesLine,
  trialPhoneLabel,
  trialStatusLabel,
} from "./trials-model.js";

/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperBusinessRow} SuperBusinessRow */
/** @typedef {import("./types.js").SuperTrialsSummaryResponse} SuperTrialsSummaryResponse */
/** @typedef {import("./trials-model.js").TrialFilter} TrialFilter */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLElementTagNameMap[K]}
 */
function node(tag, text, className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

/**
 * "Pruebas": the trials in the business directory (trial/billing columns of
 * GET /api/super/businesses) with filter chips and the platform actions the design exposes
 * (docs/product/2026-11-25-self-serve-trial.md §7.4): POST …/trial/extend { days },
 * POST …/trial/lock and POST …/billing/manual-activate { plan, note }. Every call that the
 * server does not serve yet (404) ends in a notice, never in a broken section.
 * @param {SuperPageContext} ctx
 * @param {{
 *   reloadBusinesses: () => Promise<void>,
 *   plans: { makePlanSelect(plan: string | null | undefined): HTMLSelectElement },
 * }} deps
 */
export function createTrials(ctx, { reloadBusinesses, plans }) {
  const { api, toast, state, run, element } = ctx;
  /** @type {TrialFilter} */
  let filter = "all";
  /** @type {SuperTrialsSummaryResponse | null} */
  let summary = null;

  /** @param {string} path @param {Record<string, unknown>} body @param {string} done */
  async function post(path, body, done) {
    await run(
      async () => {
        await api(path, { method: "POST", body: JSON.stringify(body) });
        toast(done);
        await reloadBusinesses();
      },
      (error) => {
        toast(
          error.status === 404
            ? "Esta acción aún no está disponible en el servidor."
            : `No se pudo completar: ${error.message}`,
        );
      },
    );
  }

  /** @param {SuperBusinessRow} row */
  async function extend(row) {
    const value = await modalPrompt(`¿Cuántos días más de prueba para ${row.name}?`, {
      title: "Extender prueba",
      inputType: "number",
      value: "7",
      confirmText: "Continuar",
    });
    if (value === null) return;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 60)
      return toast("Escribe un número de días entre 1 y 60.");
    const ok = await modalConfirm(
      `Se extenderá la prueba de ${row.name} ${days} ${days === 1 ? "día" : "días"}. La acción queda en la auditoría de plataforma.`,
      { title: "Confirmar extensión", confirmText: "Extender" },
    );
    if (!ok) return;
    await post(
      `/api/super/businesses/${encodeURIComponent(row.id)}/trial/extend`,
      { days },
      `Prueba de ${row.name} extendida ${days} ${days === 1 ? "día" : "días"}.`,
    );
  }

  /** @param {SuperBusinessRow} row */
  async function lock(row) {
    const ok = await modalConfirm(
      `Bloquear ahora la prueba de ${row.name}: el panel del dueño pasa a solo lectura y las tarjetas de sus clientes siguen visibles. La acción queda en la auditoría.`,
      { title: "Bloquear prueba", confirmText: "Bloquear" },
    );
    if (!ok) return;
    await post(
      `/api/super/businesses/${encodeURIComponent(row.id)}/trial/lock`,
      {},
      `Prueba de ${row.name} bloqueada.`,
    );
  }

  /** @param {SuperBusinessRow} row @param {string} plan */
  async function activate(row, plan) {
    const note = await modalPrompt(
      `Activar ${plan} para ${row.name} sin pasar por el cobro en línea (transferencia o factura). Nota interna:`,
      {
        title: "Activar plan manualmente",
        placeholder: "Referencia del pago o acuerdo",
        confirmText: "Continuar",
      },
    );
    if (note === null) return;
    const ok = await modalConfirm(
      `Se activará ${plan} para ${row.name} con cobro activo y se desbloqueará su panel. La acción queda en la auditoría.`,
      { title: "Confirmar activación", confirmText: "Activar plan" },
    );
    if (!ok) return;
    await post(
      `/api/super/businesses/${encodeURIComponent(row.id)}/billing/manual-activate`,
      { plan, note: note.trim() },
      `Plan ${plan} activado manualmente para ${row.name}.`,
    );
  }

  /** @param {SuperBusinessRow} row */
  function renderCard(row) {
    const card = node("div", "", "card compact-card mb-8");
    const title = node("div", "");
    title.append(
      node("strong", row.name || "Negocio"),
      node("span", ` (${row.slug || "-"})`, "small"),
    );
    const badge = node("span", trialStatusLabel(row), "badge badge-soft");
    badge.classList.add("mb-8");
    card.append(title, badge);
    card.append(
      node(
        "div",
        `${trialPhoneLabel(row)} · ${signupSourceLabel(row.signup_source)} · Plan ${row.plan} · Clientes: ${row.customers ?? "—"}`,
        "small",
      ),
    );
    const dates = trialDatesLine(row);
    if (dates) card.append(node("div", dates, "small mt-6"));
    const actions = node("div", "", "row mt-8");
    const extendBtn = node("button", "Extender prueba");
    extendBtn.addEventListener("click", () => extend(row));
    const lockBtn = node("button", "Bloquear ahora");
    lockBtn.disabled = row.billing_status === "locked";
    lockBtn.addEventListener("click", () => lock(row));
    const planSel = plans.makePlanSelect(row.plan === "EMPRENDEDOR" ? "NEGOCIO" : row.plan);
    planSel.setAttribute("aria-label", `Plan a activar para ${row.name}`);
    const activateBtn = node("button", "Activar plan manualmente", "primary");
    activateBtn.addEventListener("click", () => activate(row, planSel.value));
    actions.append(extendBtn, lockBtn, planSel, activateBtn);
    card.append(actions);
    return card;
  }

  /** @param {SuperBusinessRow[]} rows */
  function renderFilters(rows) {
    const box = element("#trialFilters");
    const counts = trialCounts(rows);
    box.replaceChildren();
    for (const [key, label] of TRIAL_FILTERS) {
      const chip = node("button", `${label} (${counts[key]})`, key === filter ? "primary" : "");
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(key === filter));
      chip.addEventListener("click", () => setFilter(key));
      box.append(chip);
    }
  }

  function renderSummary() {
    const box = element("#trialSummary");
    box.replaceChildren();
    const cohorts = Array.isArray(summary?.cohorts) ? summary.cohorts : [];
    if (!cohorts.length) return;
    const table = node("table", "", "compact-table");
    const head = node("tr", "");
    for (const label of [
      "Semana",
      "Inicios",
      "Activadas",
      "Convertidas",
      "Bloqueadas",
      "Eliminadas",
    ])
      head.append(node("th", label));
    table.append(head);
    for (const cohort of cohorts) {
      const tr = node("tr", "");
      for (const value of [
        cohort.week || cohort.period_start || "—",
        cohort.starts ?? 0,
        cohort.activated ?? 0,
        cohort.converted ?? 0,
        cohort.locked ?? 0,
        cohort.purged ?? 0,
      ])
        tr.append(node("td", String(value)));
      table.append(tr);
    }
    box.append(
      node("div", "Cohortes semanales (conteos, sin atribución causal):", "small mb-8"),
      table,
    );
    if (typeof summary?.median_days_to_first_customer === "number")
      box.append(
        node(
          "div",
          `Mediana de días hasta el primer cliente: ${summary.median_days_to_first_customer}`,
          "small mt-6",
        ),
      );
  }

  function render() {
    const rows = state.businessList || [];
    const box = element("#trialList");
    box.replaceChildren();
    if (!hasTrialColumns(rows)) {
      element("#trialFilters").replaceChildren();
      box.textContent =
        "El servidor aún no expone el estado de las pruebas (columnas trial_status y billing_status en /api/super/businesses). La sección se activa con la siguiente versión del API.";
      return;
    }
    renderFilters(rows);
    const visible = filterTrialRows(rows, filter);
    if (!visible.length) {
      box.textContent = "No hay pruebas en este filtro.";
      return;
    }
    visible.forEach((row) => box.appendChild(renderCard(row)));
  }

  /** @param {TrialFilter} next */
  function setFilter(next) {
    filter = next;
    render();
  }

  /** Read-only weekly cohorts (design §9); absent on servers without the trial API. */
  async function loadSummary() {
    summary = await run(
      async () =>
        /** @type {SuperTrialsSummaryResponse} */ (await api("/api/super/trials/summary")),
      () => null,
    );
    renderSummary();
  }

  function clear() {
    summary = null;
    element("#trialSummary").replaceChildren();
    element("#trialList").textContent = "(sin datos)";
  }

  return { render, loadSummary, setFilter, clear };
}
