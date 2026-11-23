/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperOwnerProgressSettingsResponse} SuperOwnerProgressSettingsResponse */

const MODES = [
  ["off", "Apagado (sin tarjeta ni API)"],
  ["checklist", "Solo puesta en marcha"],
  ["full", "Completo: metas, logros e impulso"],
];

/**
 * Platform-owner control of "Tu progreso" (docs/product/2026-11-23-owner-progress.md):
 * mode and the holdout share. Variants already assigned to a business never change.
 * @param {SuperPageContext} ctx
 */
export function createOwnerProgressSettings(ctx) {
  const { api, toast, state, run } = ctx;

  async function load() {
    try {
      const out = /** @type {SuperOwnerProgressSettingsResponse} */ (
        await api("/api/super/platform-settings/owner-progress")
      );
      state.ownerProgressSettings = out.settings || null;
    } catch {
      state.ownerProgressSettings = null;
    }
  }

  function render() {
    const box = document.getElementById("ownerProgressSettings");
    if (!box) return;
    box.replaceChildren();
    const current = state.ownerProgressSettings;
    if (!current) {
      box.textContent = "No se pudo cargar la configuración de Tu progreso.";
      return;
    }
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Modo";
    modeLabel.htmlFor = "ownerProgressMode";
    const mode = document.createElement("select");
    mode.id = "ownerProgressMode";
    for (const [value, text] of MODES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      mode.appendChild(option);
    }
    mode.value = current.mode;
    const pctLabel = document.createElement("label");
    pctLabel.textContent = "Grupo de control (% de negocios)";
    pctLabel.htmlFor = "ownerProgressHoldout";
    const pct = document.createElement("input");
    pct.id = "ownerProgressHoldout";
    pct.type = "number";
    pct.min = "0";
    pct.max = "100";
    pct.step = "1";
    pct.value = String(current.holdout_pct);
    const save = document.createElement("button");
    save.className = "primary";
    save.textContent = "Guardar Tu progreso";
    save.addEventListener("click", async () => {
      await run(
        async () => {
          const out = /** @type {SuperOwnerProgressSettingsResponse} */ (
            await api("/api/super/platform-settings/owner-progress", {
              method: "PUT",
              body: JSON.stringify({ mode: mode.value, holdout_pct: Number(pct.value) }),
            })
          );
          state.ownerProgressSettings = out.settings || null;
          toast("Configuración de Tu progreso guardada.");
          render();
        },
        (error) => {
          toast("No se pudo guardar: " + error.message);
        },
      );
    });
    const row = document.createElement("div");
    row.className = "row";
    row.append(modeLabel, mode, pctLabel, pct, save);
    box.appendChild(row);
  }

  return { load, render };
}
