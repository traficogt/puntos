import { api, $, toast, isStrongPassword, passwordRequirementsText } from "/lib.js";

/** @typedef {import("./types.js").AdminSignupPayload} AdminSignupPayload */
/** @typedef {import("./types.js").AdminSignupResponse} AdminSignupResponse */

/**
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function input(selector) {
  return /** @type {HTMLInputElement} */ ($(selector));
}

/**
 * @param {string} selector
 * @returns {HTMLSelectElement}
 */
function select(selector) {
  return /** @type {HTMLSelectElement} */ ($(selector));
}

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
function element(selector) {
  return /** @type {HTMLElement} */ ($(selector));
}

function toggleBoxes() {
  const t = select("#program_type").value;
  element("#spendBox").style.display = t === "SPEND" ? "block" : "none";
  element("#visitBox").style.display = t === "VISIT" ? "block" : "none";
  element("#itemBox").style.display = t === "ITEM" ? "block" : "none";
  updateProgramPreview();
}

function updateProgramPreview() {
  const t = select("#program_type").value;
  let text = "";
  if (t === "SPEND") {
    const rate = Number(input("#points_per_q").value || 0);
    const round = select("#round").value;
    const raw = 100 * rate;
    const val =
      round === "floor" ? Math.floor(raw) :
      round === "round" ? Math.round(raw) :
      Math.ceil(raw);
    text = `Vista previa: Q100 ≈ ${val} puntos.`;
  } else if (t === "VISIT") {
    text = `Vista previa: cada visita suma ${Number(input("#points_per_visit").value || 0)} puntos.`;
  } else {
    text = `Vista previa: cada item suma ${Number(input("#points_per_item").value || 0)} puntos.`;
  }
  element("#programPreview").textContent = text;
}

function updateProgress() {
  const required = [
    input("#businessName").value.trim().length > 1,
    input("#email").value.trim().includes("@"),
    isStrongPassword(input("#password").value)
  ];
  const score = required.filter(Boolean).length;
  const pct = Math.max(20, Math.round((score / required.length) * 100));
  element("#adminOnboardingProgress").style.width = `${pct}%`;
  element("#passwordHint").textContent = isStrongPassword(input("#password").value)
    ? "Excelente: contraseña fuerte."
    : passwordRequirementsText();
}

select("#program_type").addEventListener("change", toggleBoxes);
["points_per_q", "round", "points_per_visit", "points_per_item"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", updateProgramPreview);
});
["businessName", "email", "password"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", updateProgress);
});
toggleBoxes();
updateProgress();

element("#btnCreate").addEventListener("click", async () => {
  const btn = /** @type {HTMLButtonElement} */ (element("#btnCreate"));
  try {
    btn.disabled = true;
    btn.textContent = "Creando...";
    const program_type = /** @type {AdminSignupPayload["program_type"]} */ (select("#program_type").value);
    /** @type {Record<string, unknown>} */
    let program_json = {};
    if (program_type === "SPEND") program_json = { points_per_q: Number(input("#points_per_q").value), round: select("#round").value };
    if (program_type === "VISIT") program_json = { points_per_visit: Number(input("#points_per_visit").value) };
    if (program_type === "ITEM") program_json = { points_per_item: Number(input("#points_per_item").value) };

    /** @type {AdminSignupPayload} */
    const payload = {
      businessName: input("#businessName").value.trim(),
      email: input("#email").value.trim(),
      phone: input("#phone").value.trim() || undefined,
      password: input("#password").value,
      category: input("#category").value,
      program_type,
      program_json
    };

    if (!isStrongPassword(payload.password)) {
      throw new Error(passwordRequirementsText());
    }

    const out = /** @type {AdminSignupResponse} */ (await api("/api/admin/signup", { method: "POST", body: JSON.stringify(payload) }));
    element("#result").style.display = "block";
    element("#slug").textContent = out.business.slug;
    const join = `${location.origin}/join/${out.business.slug}`;
    element("#joinUrl").textContent = join;
    toast("Negocio creado. Ya estás con sesión de propietario.");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Crear negocio";
  }
});

$("#btnCopyJoin")?.addEventListener("click", async () => {
  try {
    const text = element("#joinUrl").textContent || "";
    await navigator.clipboard.writeText(text);
    toast("Enlace copiado.");
  } catch {
    toast("No se pudo copiar. Puedes copiar manualmente.");
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
