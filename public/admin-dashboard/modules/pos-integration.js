/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

const MODE_HELP = {
  loyverse: "Conecta tu cuenta de Loyverse para leer las compras pagadas en la moneda configurada.",
  csv: "Revisa y carga un archivo de ventas exportado por tu sistema, sin programar.",
  api: "Envía compras desde un sistema que permita configurar una integración por API."
};
const COLUMN_FIELDS = {
  saleId: "posCsvSaleId", customerPhone: "posCsvPhone", amountQ: "posCsvAmount",
  status: "posCsvStatus", items: "posCsvItems"
};
const saleExample = (currency="GTQ") => JSON.stringify({
  saleId: "venta-000123", source: "mi-pos", customerPhone: "50255551234",
  amountQ: 75, currency, status: "paid", items: 2, dryRun: true
}, null, 2);
const number = (value) => Math.max(0, Number(value) || 0);

/** Register the owner-only connection panel after staff and plan are available.
 * @param {AdminDashboardApp} app
 */
export function registerPosIntegration(app) {
  const root = app.$("#externalAwardsSection");
  if (!root) return;
  const el = (id) => /** @type {HTMLElement} */ (root.querySelector(`#${id}`));
  const input = (id) => /** @type {HTMLInputElement} */ (el(id));
  const button = (id) => /** @type {HTMLButtonElement} */ (el(id));
  const controls = /** @type {HTMLFieldSetElement} */ (el("posControls"));
  /** @type {any} */
  let integration = null;
  let loaded = false;
  let busy = false;
  let dirty = false;
  let bound = false;
  let csv = "";
  let csvPreview = null;
  let loyversePreview = null;
  let fileVersion = 0;

  const allowed = () => app.state.currentStaff?.role === "OWNER" && app.hasFeature("external_awards");
  const mode = () => input("posMode").value;
  const active = () => loaded && !dirty && integration?.enabled && integration.mode === mode();
  function feedback(message, error = false) {
    el("posFeedback").textContent = message;
    el("posFeedback").classList.toggle("is-error", error);
  }
  function clearKey() {
    input("posApiKey").value = "";
    el("posKeyReveal").hidden = true;
  }
  function invalidatePreview(kind) {
    if (kind === "Csv") csvPreview = null;
    else loyversePreview = null;
    el(`pos${kind}PreviewBox`).hidden = true;
    el(`pos${kind}PreviewRows`).replaceChildren();
    el(`pos${kind}PreviewSummary`).textContent = "";
    el(`pos${kind}Result`).hidden = true;
  }
  function csvPayload() {
    const columns = {};
    for (const [name, id] of Object.entries(COLUMN_FIELDS)) {
      if (input(id).value) columns[name] = input(id).value;
    }
    return { csv, source: input("posCsvSource").value.trim(), columns, amountUnit: input("posCsvUnits").value,
      assumePaid: !input("posCsvStatus").value && input("posCsvPaid").checked };
  }
  function mappingReady() {
    return csv && input("posCsvSource").value.trim() && input("posCsvSaleId").value && input("posCsvPhone").value && input("posCsvAmount").value
      && (input("posCsvStatus").value || input("posCsvPaid").checked);
  }
  function updateControls() {
    controls.disabled = busy || !loaded;
    root.setAttribute("aria-busy", String(busy));
    button("posSave").disabled = busy || !loaded;
    button("posSave").textContent = mode() === "loyverse" ? "Guardar y verificar conexión" : "Guardar conexión";
    button("posLoyversePreview").disabled = !active() || !integration?.loyverse?.configured;
    button("posLoyverseSync").disabled = !active() || !loyversePreview;
    button("posCsvPreview").disabled = !active() || !mappingReady();
    button("posCsvImport").disabled = !active() || !csvPreview || !number(csvPreview.summary?.ready);
    button("posKeyGenerate").disabled = !active();
    button("posCopyEndpoint").disabled = !input("posEndpoint").value;
    el("posCsvPaidLabel").hidden = Boolean(input("posCsvStatus").value);
    el("posSavedState").textContent = dirty
      ? "Hay cambios sin guardar. Guarda la conexión antes de continuar."
      : integration?.enabled ? "Conexión habilitada." : "Conexión pausada. Habilítala y guarda para enviar o importar ventas.";
  }
  function showMode() {
    for (const name of ["Loyverse", "Csv", "Api"]) el(`pos${name}Panel`).hidden = mode() !== name.toLowerCase();
    el("posLoyverseSetup").hidden = mode() !== "loyverse";
    el("posModeHelp").textContent = MODE_HELP[mode()] || "";
    updateControls();
  }
  function markDirty() {
    dirty = true;
    invalidatePreview("Csv");
    invalidatePreview("Loyverse");
    showMode();
  }
  function renderConnection(out) {
    integration = out.integration;
    if (!integration) throw new Error("La respuesta de la conexión está incompleta. Vuelve a intentarlo.");
    loaded = true;
    dirty = false;
    input("posMode").value = ["loyverse", "csv", "api"].includes(integration.mode) ? integration.mode : "csv";
    input("posEnabled").checked = Boolean(integration.enabled);
    input("posAutomatic").checked = Boolean(integration.automatic);
    input("posLoyverseToken").value = "";
    input("posLoyverseStore").value = integration.loyverse?.store_id || "";
    el("posTokenHint").textContent = integration.loyverse?.configured
      ? "Token guardado. Déjalo vacío para conservarlo o pega uno nuevo para reemplazarlo."
      : "Crea un token de acceso en tu cuenta de Loyverse y pégalo aquí. Se verificará al guardar.";
    el("posMerchant").textContent = integration.loyverse?.merchant_name
      ? `Cuenta conectada: ${integration.loyverse.merchant_name}.` : "Guarda un token para verificar tu cuenta de Loyverse.";
    const sync = integration.last_sync;
    const syncIssues = el("posSyncIssues");
    syncIssues.replaceChildren();
    syncIssues.hidden = !sync?.issues?.length;
    for (const issue of sync?.issues || []) {
      const li = document.createElement("li");
      li.textContent = `${issue.saleId || "Sincronización"}: ${issue.message || issue.code || "Requiere revisión."}`;
      syncIssues.append(li);
    }
    if (sync) {
      const date = new Date(sync.at || sync.completed_at || sync.timestamp || sync.started_at || "");
      const when = Number.isNaN(date.getTime()) ? "" : ` · ${date.toLocaleString("es-GT")}`;
      const error = sync.error || (sync.status === "error" ? sync.message : "");
      el("posLastSync").textContent = error ? `Última sincronización${when}: ${error}`
        : `Última sincronización${when}. Ventas con puntos: ${number(sync.awarded ?? sync.result?.awarded)}; repetidas: ${number(sync.duplicates ?? sync.result?.duplicates)}; omitidas: ${number(sync.ignored)}; con errores: ${number(sync.errors)}. Pendientes de corregir y reintentar: ${number(sync.pending)}.`;
      el("posLastSync").classList.toggle("is-error", Boolean(error) || sync.status === "error");
    } else {
      el("posLastSync").textContent = "Aún no se han sincronizado ventas.";
      el("posLastSync").classList.remove("is-error");
    }
    if (out.business?.slug) input("posEndpoint").value = `${location.origin}/api/v1/public/pos/${encodeURIComponent(out.business.slug)}/sales`;
    el("posKeyStatus").textContent = integration.has_api_key
      ? `Clave guardada${integration.api_key_masked ? `: ${integration.api_key_masked}` : ""}. Solo se muestra completa al generarla.`
      : "Aún no hay una clave API. Genera una para conectar tu sistema.";
    button("posKeyGenerate").textContent = integration.has_api_key ? "Generar nueva clave API" : "Generar clave API";
    el("posReload").hidden = true;
    showMode();
  }
  function errorMessage(error) {
    if (error?.status === 404 || /HTTP 404|Cannot (GET|POST|PUT)|^No encontrado(?: \(Ref:.*\))?$/i.test(error?.message || "")) {
      return "La conexión de ventas aún no está disponible. Reintenta más tarde.";
    }
    return error?.message || "No se pudo completar la operación. Vuelve a intentarlo.";
  }
  async function run(message, task) {
    if (busy || !allowed()) return;
    busy = true;
    feedback(message);
    updateControls();
    try {
      await task();
    } catch (error) {
      feedback(errorMessage(error), true);
      if (!loaded) el("posReload").hidden = false;
    } finally {
      busy = false;
      updateControls();
    }
  }
  async function load() {
    await run("Cargando conexión…", async () => {
      renderConnection(await app.api("/api/admin/pos"));
      feedback("Elige un método y configura tu conexión.");
    });
  }
  function post(path, body = {}) {
    return app.api(`/api/admin/pos/${path}`, { method: "POST", body: JSON.stringify(body) });
  }
  function renderPreview(kind, preview) {
    const summary = preview.summary || {};
    el(`pos${kind}PreviewSummary`).textContent = `Ventas revisadas: ${number(summary.total)}. Listas: ${number(summary.ready)}; repetidas: ${number(summary.duplicates)}; omitidas: ${number(summary.ignored)}; con errores: ${number(summary.errors)}. La vista previa no asigna puntos.`;
    const rows = el(`pos${kind}PreviewRows`);
    rows.replaceChildren();
    for (const sale of preview.rows || []) {
      const tr = document.createElement("tr");
      const label = { ready: "Lista", duplicate: "Repetida", ignored: "Omitida", error: "Error" }[sale.status] || "Sin validar";
      for (const value of [sale.row ?? "—", sale.saleId || "—", sale.customerPhone || "—",
        Number.isFinite(Number(sale.amountQ)) && sale.amountQ !== null ? new Intl.NumberFormat(integration?.region?.locale || "es-GT",{style:"currency",currency:integration?.region?.currency || "GTQ"}).format(Number(sale.amountQ)) : "—",
        sale.points ?? "—", `${label}${sale.message ? ` · ${sale.message}` : ""}`]) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.append(td);
      }
      rows.append(tr);
    }
    el(`pos${kind}PreviewBox`).hidden = false;
  }
  function renderResult(kind, result) {
    const box = el(`pos${kind}Result`);
    box.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `Ventas con puntos asignados: ${number(result.awarded)}. Repetidas: ${number(result.duplicates)}; omitidas: ${number(result.ignored)}; con errores: ${number(result.errors)}.`;
    box.append(summary);
    if (result.has_more) {
      const more = document.createElement("p");
      more.textContent = "Quedan ventas por revisar. Consulta la siguiente vista previa para continuar.";
      box.append(more);
    }
    if (result.issues?.length) {
      const list = document.createElement("ul");
      for (const issue of result.issues) {
        const li = document.createElement("li");
        li.textContent = `${issue.saleId || (issue.row ? `Fila ${issue.row}` : "Venta")}: ${issue.message || issue.code || "No se pudo importar."}`;
        list.append(li);
      }
      box.append(list);
    }
    box.hidden = false;
  }
  async function save() {
    await run("Guardando y verificando la conexión…", async () => {
      const payload = { enabled: input("posEnabled").checked, mode: mode(), automatic: mode() === "loyverse" && input("posAutomatic").checked };
      if (mode() === "loyverse") {
        payload["loyverse"] = { store_id: input("posLoyverseStore").value.trim() };
        const token = input("posLoyverseToken").value.trim();
        if (token) payload["loyverse"].access_token = token;
      }
      renderConnection(await app.api("/api/admin/pos", { method: "PUT", body: JSON.stringify(payload) }));
      invalidatePreview("Csv");
      invalidatePreview("Loyverse");
      feedback(integration.enabled ? "Conexión guardada. Ya puedes revisar tus ventas." : "Conexión pausada. No se asignarán puntos por esta conexión.");
    });
  }
  async function inspectFile() {
    const version = ++fileVersion;
    csv = "";
    invalidatePreview("Csv");
    el("posCsvMapping").hidden = true;
    input("posCsvPaid").checked = false;
    const file = input("posCsvFile").files?.[0];
    if (!file) {
      el("posCsvFileStatus").textContent = "Selecciona un archivo para elegir sus columnas.";
      updateControls();
      return;
    }
    await run("Leyendo las columnas del archivo…", async () => {
      if (file.size > 200 * 1024) throw new Error("El archivo es demasiado grande. Exporta como máximo 100 ventas y 200 KB e inténtalo de nuevo.");
      const text = await file.text();
      const out = await post("csv/preview", { csv: text });
      if (version !== fileVersion) return;
      if (!Array.isArray(out.headers) || !out.headers.length) throw new Error("No se encontraron encabezados. Revisa el archivo CSV y vuelve a seleccionarlo.");
      csv = text;
      for (const [name, id] of Object.entries(COLUMN_FIELDS)) {
        const select = /** @type {HTMLSelectElement} */ (el(id));
        select.replaceChildren(new Option(["status", "items"].includes(name) ? "Sin columna" : "Elige una columna", ""));
        for (const header of out.headers) select.add(new Option(String(header), String(header)));
      }
      input("posCsvUnits").value = "major";
      el("posCsvFileStatus").textContent = `${file.name} · ${out.headers.length} columnas encontradas.`;
      el("posCsvMapping").hidden = false;
      feedback("Relaciona las columnas del archivo y revisa las ventas.");
    });
    if (!csv) el("posCsvFileStatus").textContent = "No se pudo leer el archivo. Corrígelo y vuelve a seleccionarlo.";
  }
  async function previewCsv() {
    if (!active() || !mappingReady()) return;
    invalidatePreview("Csv");
    await run("Revisando ventas sin asignar puntos…", async () => {
      const out = await post("csv/preview", csvPayload());
      csvPreview = out;
      renderPreview("Csv", out);
      feedback(number(out.summary?.ready) ? "Vista previa lista. Comprueba los datos antes de importar." : "No hay ventas listas para importar. Revisa los mensajes de cada fila.");
    });
  }
  async function importCsv() {
    if (!active() || !csvPreview || !number(csvPreview.summary?.ready)) return;
    await run("Importando las ventas revisadas…", async () => {
      const payload = csvPayload();
      csvPreview = null;
      const out = await post("csv/import", payload);
      invalidatePreview("Csv");
      renderResult("Csv", out.result || {});
      feedback("Importación terminada. Revisa el resultado de las ventas.");
    });
  }
  async function previewLoyverse() {
    if (!active() || !integration?.loyverse?.configured) return;
    invalidatePreview("Loyverse");
    await run("Consultando Loyverse sin asignar puntos…", async () => {
      const out = await post("loyverse/preview");
      loyversePreview = out;
      renderPreview("Loyverse", out);
      feedback(number(out.summary?.ready) ? "Vista previa lista. Puedes sincronizar estas ventas." : out.has_more ? "Este grupo no tiene ventas listas. Sincroniza para avanzar al siguiente grupo." : "No hay ventas nuevas listas para asignar puntos.");
    });
  }
  async function syncLoyverse() {
    if (!active() || !loyversePreview || busy) return;
    await run("Confirma la sincronización de ventas.", async () => {
      const confirmed = await app.confirm(`Ventas listas en la revisión: ${number(loyversePreview.summary?.ready)}. ¿Sincronizar el siguiente grupo de ventas de Loyverse y asignar sus puntos? Las ventas repetidas se omiten.`);
      if (!confirmed) { feedback("Sincronización cancelada. No se asignaron puntos."); return; }
      loyversePreview = null;
      const out = await post("loyverse/sync");
      invalidatePreview("Loyverse");
      renderResult("Loyverse", out.result || {});
      feedback("Sincronización terminada. Revisa el resultado de las ventas.");
      // Refresh safe status without hiding a completed result if the refresh fails.
      try { renderConnection(await app.api("/api/admin/pos")); } catch { /* Result remains available. */ }
    });
  }
  async function generateKey() {
    if (!active() || busy) return;
    await run("Confirma la creación de la clave API.", async () => {
      if (integration.has_api_key && !await app.confirm("Generar una nueva clave desactivará la anterior inmediatamente. Tendrás que actualizar cualquier integración que la use. ¿Generar la nueva clave API?")) {
        feedback("No se cambió la clave API.");
        return;
      }
      clearKey();
      const out = await post("key");
      renderConnection({ integration: out.integration });
      input("posApiKey").value = out.api_key || "";
      el("posKeyReveal").hidden = false;
      feedback("Clave generada. Cópiala ahora: solo se mostrará una vez.");
    });
    if (!el("posKeyReveal").hidden) input("posApiKey").focus();
  }
  async function copy(value, fieldId) {
    try {
      await navigator.clipboard.writeText(value);
      app.toast("Copiado al portapapeles.");
    } catch {
      if (fieldId) { input(fieldId).focus(); input(fieldId).select(); }
      feedback("No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.", true);
    }
  }
  function bind() {
    if (bound) return;
    bound = true;
    button("posReload").addEventListener("click", load);
    button("posSave").addEventListener("click", save);
    input("posMode").addEventListener("change", () => { clearKey(); markDirty(); });
    for (const id of ["posEnabled", "posAutomatic", "posLoyverseToken", "posLoyverseStore"]) input(id).addEventListener("input", markDirty);
    input("posCsvFile").addEventListener("change", inspectFile);
    input("posCsvSource").addEventListener("input", () => { invalidatePreview("Csv"); updateControls(); });
    for (const id of [...Object.values(COLUMN_FIELDS), "posCsvUnits", "posCsvPaid"]) input(id).addEventListener("change", () => {
      invalidatePreview("Csv");
      updateControls();
      feedback("Las columnas cambiaron. Revisa las ventas de nuevo antes de importar.");
    });
    button("posCsvPreview").addEventListener("click", previewCsv);
    button("posCsvImport").addEventListener("click", importCsv);
    button("posLoyversePreview").addEventListener("click", previewLoyverse);
    button("posLoyverseSync").addEventListener("click", syncLoyverse);
    button("posKeyGenerate").addEventListener("click", generateKey);
    button("posCopyEndpoint").addEventListener("click", () => copy(input("posEndpoint").value, "posEndpoint"));
    button("posCopyKey").addEventListener("click", () => copy(input("posApiKey").value, "posApiKey"));
    button("posCopySample").addEventListener("click", () => copy(saleExample(integration?.region?.currency || "GTQ")));
    button("posHideKey").addEventListener("click", () => { clearKey(); button("posKeyGenerate").focus(); feedback("Clave ocultada. La conexión está lista para usarla."); });
    window.addEventListener("pagehide", clearKey);
    el("posApiSample").textContent = saleExample(integration?.region?.currency || "GTQ");
  }
  app.onAfterPlanReady(async () => {
    root.hidden = !allowed();
    if (!allowed()) return;
    bind();
    await load();
  });
}
