/** @typedef {import("./types.js").SuperCustomerListResponse} SuperCustomerListResponse */
/** @typedef {import("./types.js").SuperMagicLinkResponse} SuperMagicLinkResponse */
/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperStaffListResponse} SuperStaffListResponse */
/** @typedef {import("./types.js").SuperStaffRow | import("./types.js").SuperCustomerRow} SuperMagicActorRow */

const MAGIC_TARGET_OPTIONS = {
  staff: [
    { value: "staff", label: "Escáner" },
    { value: "admin-dashboard", label: "Panel" },
  ],
  customer: [{ value: "customer-wallet", label: "Cartera" }],
};

/**
 * Internal magic links: pick a business, an actor (staff or customer) and a
 * destination, then mint a link for support.
 * @param {SuperPageContext} ctx
 */
export function createMagicLinks(ctx) {
  const { api, toast, state, run, element, select } = ctx;

  function getMagicMode() {
    return select("#magicActorType").value || "staff";
  }

  function getMagicBusinessId() {
    return select("#magicBusiness").value || "";
  }

  function getMagicActorSelect() {
    return select("#magicActor");
  }

  function getMagicTargetSelect() {
    return select("#magicTarget");
  }

  /**
   * Staff rows carry a role; customer rows do not.
   * @param {SuperMagicActorRow | null} actorRow
   */
  function actorRole(actorRow) {
    return String(actorRow && "role" in actorRow ? actorRow.role : "").toUpperCase();
  }

  function getMagicSelectedActor() {
    const actorId = getMagicActorSelect().value;
    return state.magicActorRows.find((row) => String(row.id) === String(actorId)) || null;
  }

  /** @param {SuperMagicActorRow | null} [actorRow] */
  function setMagicCopy(actorRow = null) {
    const box = element("#magicLinkCopy");
    const mode = getMagicMode();
    if (mode === "customer") {
      box.textContent = "Uso interno · Reutilizable hasta vencer";
      return;
    }
    const role = actorRole(actorRow);
    box.textContent = role === "OWNER" ? "Uso interno · Un solo uso" : "Uso interno · Un solo uso";
  }

  function setMagicOutput(text) {
    element("#magicLinkOutput").textContent = text || "(sin enlace generado)";
  }

  /** @param {SuperMagicActorRow | null} [actorRow] */
  function renderMagicTargetOptions(actorRow = null) {
    const mode = getMagicMode();
    const targetSel = getMagicTargetSelect();
    const allowed = MAGIC_TARGET_OPTIONS[mode] || MAGIC_TARGET_OPTIONS.staff;
    targetSel.replaceChildren();

    allowed.forEach((target) => {
      const opt = document.createElement("option");
      opt.value = target.value;
      opt.textContent = target.label;
      if (
        mode === "staff" &&
        target.value === "admin-dashboard" &&
        actorRole(actorRow) !== "OWNER"
      ) {
        opt.disabled = true;
      }
      targetSel.appendChild(opt);
    });

    const current = targetSel.value;
    const preferred = mode === "customer" ? "customer-wallet" : current || "staff";
    const allowedValues = allowed.map((target) => target.value);
    const selectedRole = actorRole(actorRow);
    const nextTarget =
      allowedValues.includes(preferred) &&
      !(preferred === "admin-dashboard" && mode === "staff" && selectedRole !== "OWNER")
        ? preferred
        : allowedValues[0];
    targetSel.value = nextTarget;
    targetSel.disabled = mode === "customer";
  }

  function renderMagicActorOptions(rows) {
    const actorSel = getMagicActorSelect();
    actorSel.replaceChildren();

    if (!rows.length) {
      actorSel.disabled = true;
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Sin resultados";
      actorSel.appendChild(opt);
      actorSel.value = "";
      renderMagicTargetOptions(null);
      setMagicCopy(null);
      setMagicOutput("(sin enlace generado)");
      return;
    }

    actorSel.disabled = false;
    rows.forEach((row) => {
      const opt = document.createElement("option");
      opt.value = row.id;
      const name = row.name || row.email || row.phone || row.id;
      const role = row.role ? ` · ${String(row.role).toUpperCase()}` : "";
      opt.textContent = `${name}${role}`;
      opt.dataset.role = String(row.role || "");
      actorSel.appendChild(opt);
    });

    const current = rows.find((row) => String(row.id) === String(actorSel.value)) || rows[0];
    actorSel.value = current?.id || "";
    renderMagicTargetOptions(current);
    setMagicCopy(current);
  }

  function renderMagicBusinessOptions() {
    const businessSel = select("#magicBusiness");
    const current = businessSel.value;
    businessSel.replaceChildren();
    state.businessList.forEach((business) => {
      const opt = document.createElement("option");
      opt.value = business.id;
      opt.textContent = `${business.name}${business.slug ? ` (${business.slug})` : ""}`;
      businessSel.appendChild(opt);
    });
    if (!state.businessList.length) {
      businessSel.disabled = true;
      businessSel.value = "";
      return;
    }
    businessSel.disabled = false;
    const selected = state.businessList.some((business) => business.id === current)
      ? current
      : state.businessList[0].id;
    businessSel.value = selected;
  }

  async function loadMagicActors() {
    const businessId = getMagicBusinessId();
    const mode = getMagicMode();
    const business = state.businessList.find((row) => row.id === businessId) || null;
    if (!businessId || !business) {
      state.magicActorRows = [];
      renderMagicActorOptions([]);
      setMagicOutput("(sin enlace generado)");
      return;
    }

    await run(
      async () => {
        const path =
          mode === "customer"
            ? `/api/super/businesses/${encodeURIComponent(businessId)}/customers`
            : `/api/super/businesses/${encodeURIComponent(businessId)}/staff`;
        const out =
          mode === "customer"
            ? /** @type {SuperCustomerListResponse} */ (await api(path))
            : /** @type {SuperStaffListResponse} */ (await api(path));
        state.magicActorRows = out.rows || [];
        renderMagicActorOptions(state.magicActorRows);
      },
      (error) => {
        state.magicActorRows = [];
        renderMagicActorOptions([]);
        setMagicOutput("No se pudieron cargar actores: " + error.message);
      },
    );
  }

  function renderMagicTargetFromSelection() {
    const actor = getMagicSelectedActor();
    renderMagicTargetOptions(actor);
    setMagicCopy(actor);
  }

  async function generateMagicLink() {
    await run(
      async () => {
        const actorType = getMagicMode();
        const businessId = getMagicBusinessId();
        const actor = getMagicSelectedActor();
        const actorId = getMagicActorSelect().value;
        const target = getMagicTargetSelect().value;
        if (!businessId) return toast("Selecciona un negocio.");
        if (!actorId) return toast("Selecciona un actor.");
        if (!target) return toast("Selecciona un destino.");

        const out = /** @type {SuperMagicLinkResponse} */ (
          await api("/api/super/magic-links", {
            method: "POST",
            body: JSON.stringify({ actorType, actorId, businessId, target }),
          })
        );
        const expiresAt = out.expiresAt ? new Date(out.expiresAt) : null;
        const copy =
          actorType === "customer"
            ? "Uso interno · Reutilizable hasta vencer"
            : "Uso interno · Un solo uso";
        const expiryText = expiresAt ? expiresAt.toLocaleString("es-GT") : "sin fecha";
        setMagicOutput(`URL: ${out.url || "(sin URL)"}\nExpira: ${expiryText}\n${copy}`);
        setMagicCopy(actor);
        toast("Enlace interno generado.");
      },
      (error) => {
        setMagicOutput("No se pudo generar el enlace: " + error.message);
        toast(error.message);
      },
    );
  }

  function bind() {
    element("#magicActorType").addEventListener("change", async () => {
      await loadMagicActors();
      renderMagicTargetFromSelection();
    });
    element("#magicBusiness").addEventListener("change", async () => {
      await loadMagicActors();
    });
    element("#magicActor").addEventListener("change", () => {
      renderMagicTargetFromSelection();
    });
    element("#magicTarget").addEventListener("change", () => {
      setMagicCopy(getMagicSelectedActor());
    });
    element("#btnGenerateMagicLink").addEventListener("click", generateMagicLink);
  }

  return { bind, loadMagicActors, renderMagicBusinessOptions };
}
