import { modalConfirm } from "/lib.js";
import {
  BILLING_PLANS,
  SUBSCRIPTION_FILTERS,
  billingEventLabel,
  billingUnavailableNotice,
  buildCatalogPayload,
  canCancelSubscription,
  catalogPriceIds,
  filterSubscriptions,
  formatDay,
  formatMinor,
  sortBillingEvents,
  subscriptionAmountLine,
  subscriptionCounts,
  subscriptionDatesLine,
  subscriptionStatusLabel,
} from "./billing-model.js";

/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperBillingSubscriptionRow} SuperBillingSubscriptionRow */
/** @typedef {import("./types.js").SuperBillingSubscriptionsResponse} SuperBillingSubscriptionsResponse */
/** @typedef {import("./types.js").SuperBillingEventsResponse} SuperBillingEventsResponse */
/** @typedef {import("./types.js").SuperBillingCatalog} SuperBillingCatalog */
/** @typedef {import("./types.js").SuperBillingCatalogResponse} SuperBillingCatalogResponse */
/** @typedef {import("./billing-model.js").SubscriptionFilter} SubscriptionFilter */

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

/** @param {string} id @param {string} label @param {string} value @param {{ type?: string, step?: string, min?: string, placeholder?: string }} [opts] */
function field(id, label, value, opts = {}) {
  const wrap = node("label", "", "small");
  wrap.htmlFor = id;
  wrap.append(document.createTextNode(label));
  const input = document.createElement("input");
  input.id = id;
  input.type = opts.type || "text";
  if (opts.step) input.step = opts.step;
  if (opts.min) input.min = opts.min;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.value = value;
  input.inputMode = opts.type === "number" ? "decimal" : "text";
  wrap.append(input);
  return { wrap, input };
}

/**
 * "Suscripciones y cobro" (wave 2 of docs/product/2026-11-25-self-serve-trial.md, §7.4):
 * the billing catalog (USD read-only as published, GTQ list amounts and a dated reference,
 * provider price ids read-only, "Sincronizar productos"), the subscriptions per business
 * with a status filter, the events drawer of each one and the platform-only cancel. Every
 * endpoint the server does not serve (404) or cannot serve without a provider (503
 * BILLING_UNAVAILABLE) ends in a notice, never in a broken section.
 * @param {SuperPageContext} ctx
 * @param {{ reloadBusinesses: () => Promise<void> }} deps
 */
export function createBilling(ctx, { reloadBusinesses }) {
  const { api, toast, run, element } = ctx;
  /** @type {SubscriptionFilter} */
  let filter = "all";
  /** @type {SuperBillingSubscriptionRow[]} */
  let rows = [];
  /** @type {SuperBillingCatalog | null} */
  let catalog = null;

  // ---- Catalog ------------------------------------------------------------------------

  /** @param {string | null} notice */
  function renderCatalog(notice) {
    const box = element("#billingCatalog");
    box.replaceChildren();
    if (notice) {
      box.append(node("div", notice, "small"));
      return;
    }
    if (!catalog) {
      box.textContent = "(sin datos)";
      return;
    }
    const ids = catalogPriceIds(catalog);
    const table = node("table", "", "compact-table");
    const head = node("tr", "");
    for (const label of ["Plan", "USD publicado", "GTQ (lista)", "Price id USD", "Price id GTQ"])
      head.append(node("th", label));
    table.append(head);
    /** @type {Record<string, HTMLInputElement>} */
    const gtqInputs = {};
    for (const plan of BILLING_PLANS) {
      const tr = node("tr", "");
      tr.append(node("td", plan));
      tr.append(node("td", formatMinor((Number(catalog.usd?.[plan]) || 0) * 100, "USD")));
      const gtqCell = node("td", "");
      const { input } = field(
        `billingGtq${plan}`,
        "",
        catalog.gtq?.[plan] !== undefined && catalog.gtq?.[plan] !== null
          ? String(catalog.gtq[plan])
          : "",
        { type: "number", step: "1", min: "1", placeholder: "Q por sucursal/mes" },
      );
      input.setAttribute("aria-label", `Monto en quetzales de ${plan}`);
      gtqInputs[plan] = input;
      gtqCell.append(input);
      tr.append(gtqCell);
      tr.append(node("td", ids.USD[plan] || "—", "small"));
      tr.append(node("td", ids.GTQ[plan] || "—", "small"));
      table.append(tr);
    }
    box.append(table);
    box.append(
      node(
        "div",
        `Los montos en USD son los publicados en /precios (${catalog.published_at ? `desde ${catalog.published_at}` : "código"}) y solo cambian en el código; se cobran a negocios fuera de Guatemala. Los montos en quetzales son precios de lista fijos elegidos por el dueño (Q300, Q630 y Q1,030 por defecto), no una conversión; se cobran a negocios de Guatemala. Deja los tres vacíos para volver a los valores del código. Todos los montos incluyen IVA. Los price ids los crea "Sincronizar productos".`,
        "small mt-6",
      ),
    );
    const reference = node("div", "", "row mt-8");
    const rate = field(
      "billingGtqRate",
      "Tasa de referencia (opcional) ",
      catalog.gtq_reference?.rate !== undefined && catalog.gtq_reference !== null
        ? String(catalog.gtq_reference.rate)
        : "",
      { type: "number", step: "0.0001", min: "0", placeholder: "7.70" },
    );
    const asOf = field(
      "billingGtqAsOf",
      "Fecha de la tasa (AAAA-MM-DD) ",
      catalog.gtq_reference?.as_of || "",
      { placeholder: "2026-11-25" },
    );
    reference.append(rate.wrap, asOf.wrap);
    box.append(reference);
    box.append(
      node(
        "div",
        "La tasa con fecha es solo informativa (se expone en el API público de planes); /precios muestra el precio de lista en quetzales y no cambia ningún cobro.",
        "small mt-6",
      ),
    );
    const actions = node("div", "", "row mt-8");
    const save = node("button", "Guardar catálogo", "primary");
    save.type = "button";
    save.addEventListener("click", () =>
      saveCatalog({
        gtq: Object.fromEntries(BILLING_PLANS.map((plan) => [plan, gtqInputs[plan].value])),
        rate: rate.input.value,
        as_of: asOf.input.value,
      }),
    );
    const sync = node("button", "Sincronizar productos");
    sync.type = "button";
    sync.addEventListener("click", syncCatalog);
    actions.append(save, sync);
    box.append(actions);
  }

  async function loadCatalog() {
    const out = await run(
      async () =>
        /** @type {SuperBillingCatalogResponse} */ (await api("/api/super/billing/catalog")),
      (error) => {
        renderCatalog(
          billingUnavailableNotice(error) || `No se pudo cargar el catálogo: ${error.message}`,
        );
        return null;
      },
    );
    if (!out) return;
    catalog = out.catalog || null;
    renderCatalog(null);
  }

  /** @param {{ gtq: Record<string, string>, rate: string, as_of: string }} form */
  async function saveCatalog(form) {
    if (!catalog) return toast("Recarga la página antes de guardar el catálogo.");
    const { payload, error } = buildCatalogPayload(catalog, form);
    if (error || !payload) return toast(error || "No se pudo preparar el catálogo.");
    return run(
      async () => {
        const out = /** @type {SuperBillingCatalogResponse} */ (
          await api("/api/super/billing/catalog", {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        );
        catalog = out.catalog || catalog;
        renderCatalog(null);
        toast("Catálogo de cobro actualizado.");
      },
      (error) => {
        toast(billingUnavailableNotice(error) || `No se pudo guardar: ${error.message}`);
      },
    );
  }

  async function syncCatalog() {
    const ok = await modalConfirm(
      "Crear o actualizar en Recurrente los productos de los tres planes en las dos monedas (seis productos: USD para negocios fuera de Guatemala y GTQ para Guatemala) con los precios del catálogo. Los price ids resultantes se guardan aquí; los productos ya existentes no cambian de precio.",
      { title: "Sincronizar productos", confirmText: "Sincronizar" },
    );
    if (!ok) return;
    await run(
      async () => {
        const out = /** @type {SuperBillingCatalogResponse} */ (
          await api("/api/super/billing/catalog/sync", { method: "POST", body: "{}" })
        );
        catalog = out.catalog || catalog;
        renderCatalog(null);
        toast("Productos sincronizados con Recurrente.");
      },
      (error) => {
        toast(billingUnavailableNotice(error) || `No se pudo sincronizar: ${error.message}`);
      },
    );
  }

  // ---- Subscriptions ------------------------------------------------------------------

  /** @param {SuperBillingSubscriptionRow} row @param {HTMLElement} box */
  async function loadEvents(row, box) {
    box.textContent = "Cargando movimientos…";
    const out = await run(
      async () =>
        /** @type {SuperBillingEventsResponse} */ (
          await api(`/api/super/billing/events?business_id=${encodeURIComponent(row.business_id)}`)
        ),
      (error) => {
        box.textContent =
          billingUnavailableNotice(error) ||
          `No se pudieron cargar los movimientos: ${error.message}`;
        return null;
      },
    );
    if (!out) return;
    const events = sortBillingEvents(Array.isArray(out.events) ? out.events : []);
    box.replaceChildren();
    if (!events.length) {
      box.textContent = "Sin movimientos registrados.";
      return;
    }
    const table = node("table", "", "compact-table");
    const head = node("tr", "");
    for (const label of ["Fecha", "Evento", "Monto", "Comisión", "Comprobante"])
      head.append(node("th", label));
    table.append(head);
    for (const event of events) {
      const tr = node("tr", "");
      tr.append(node("td", formatDay(event.occurred_at)));
      tr.append(node("td", billingEventLabel(event.type)));
      tr.append(node("td", formatMinor(event.amount_minor, event.currency)));
      tr.append(node("td", formatMinor(event.fee_minor, event.currency)));
      const receipt = node("td", "");
      if (event.tax_invoice_url) {
        const link = node("a", "Ver comprobante");
        link.href = event.tax_invoice_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        receipt.append(link);
      } else receipt.textContent = "—";
      tr.append(receipt);
      table.append(tr);
    }
    box.append(table);
  }

  /** @param {SuperBillingSubscriptionRow} row */
  async function cancel(row) {
    const name = row.business_name || row.slug || row.business_id;
    const ok = await modalConfirm(
      `Cancelar la suscripción de ${name} en Recurrente. No se reembolsa lo ya pagado; el negocio conserva el acceso hasta el final del período pagado y después su panel pasa a solo lectura. La acción queda en la auditoría de plataforma.`,
      { title: "Cancelar suscripción", confirmText: "Cancelar suscripción" },
    );
    if (!ok) return;
    await run(
      async () => {
        await api(`/api/super/businesses/${encodeURIComponent(row.business_id)}/billing/cancel`, {
          method: "POST",
          body: "{}",
        });
        toast(`Suscripción de ${name} cancelada.`);
        await loadSubscriptions();
        await reloadBusinesses();
      },
      (error) => {
        toast(
          billingUnavailableNotice(error) || `No se pudo cancelar la suscripción: ${error.message}`,
        );
      },
    );
  }

  /** @param {SuperBillingSubscriptionRow} row */
  function renderCard(row) {
    const card = node("div", "", "card compact-card mb-8");
    const title = node("div", "");
    const link = node("a", row.business_name || "Negocio");
    link.href = `#negocio-${row.business_id}`;
    link.title = "Ver el negocio en la sección Negocios";
    title.append(node("strong", ""), link);
    title.firstChild?.remove();
    title.append(node("span", ` (${row.slug || "-"})`, "small"));
    const badge = node("span", subscriptionStatusLabel(row.status), "badge badge-soft");
    badge.classList.add("mb-8");
    card.append(title, badge);
    card.append(node("div", subscriptionAmountLine(row), "small"));
    const dates = subscriptionDatesLine(row);
    if (dates) card.append(node("div", dates, "small mt-6"));
    const details = document.createElement("details");
    details.className = "operations-disclosure mt-8";
    const summary = node("summary", "Movimientos");
    const box = node("div", "", "small mt-6");
    details.append(summary, box);
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (details.open && !loaded) {
        loaded = true;
        void loadEvents(row, box);
      }
    });
    card.append(details);
    if (canCancelSubscription(row)) {
      const actions = node("div", "", "row mt-8");
      const cancelBtn = node("button", "Cancelar suscripción", "danger");
      cancelBtn.type = "button";
      cancelBtn.addEventListener("click", () => cancel(row));
      actions.append(cancelBtn);
      card.append(actions);
    }
    return card;
  }

  function renderFilters() {
    const box = element("#subscriptionFilters");
    const counts = subscriptionCounts(rows);
    box.replaceChildren();
    for (const [key, label] of SUBSCRIPTION_FILTERS) {
      const chip = node("button", `${label} (${counts[key]})`, key === filter ? "primary" : "");
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(key === filter));
      chip.addEventListener("click", () => setFilter(key));
      box.append(chip);
    }
  }

  /** @param {string | null} notice */
  function renderList(notice) {
    const box = element("#subscriptionList");
    box.replaceChildren();
    if (notice) {
      element("#subscriptionFilters").replaceChildren();
      box.textContent = notice;
      return;
    }
    renderFilters();
    const visible = filterSubscriptions(rows, filter);
    if (!visible.length) {
      box.textContent = "No hay suscripciones en este filtro.";
      return;
    }
    visible.forEach((row) => box.appendChild(renderCard(row)));
  }

  /** @param {SubscriptionFilter} next */
  function setFilter(next) {
    filter = next;
    renderList(null);
  }

  async function loadSubscriptions() {
    const out = await run(
      async () =>
        /** @type {SuperBillingSubscriptionsResponse} */ (
          await api("/api/super/billing/subscriptions")
        ),
      (error) => {
        rows = [];
        renderList(
          billingUnavailableNotice(error) ||
            `No se pudieron cargar las suscripciones: ${error.message}`,
        );
        return null;
      },
    );
    if (!out) return;
    rows = Array.isArray(out.subscriptions) ? out.subscriptions : [];
    renderList(null);
  }

  async function load() {
    await loadCatalog();
    await loadSubscriptions();
  }

  function clear() {
    rows = [];
    catalog = null;
    element("#billingCatalog").textContent = "(sin datos)";
    element("#subscriptionList").textContent = "(sin datos)";
  }

  return { load, loadCatalog, loadSubscriptions, setFilter, clear };
}
