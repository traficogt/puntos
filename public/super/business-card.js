/** @typedef {import("./types.js").SuperBusinessRow} SuperBusinessRow */
/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */

/** @type {Array<[string, string]>} */
const BROADCAST_STATES = [
  ["off", "Desactivada"],
  ["on", "Activada"],
];
/** @type {Array<[string, string]>} */
const BROADCAST_POLICIES = [
  ["wallet_first_sms_fallback", "Billetera, SMS de respaldo"],
  ["wallet_only", "Solo billetera (sin SMS)"],
  ["sms_only", "Solo SMS (sin billetera)"],
];

/** @param {Array<[string, string]>} options */
function makeSelect(options) {
  const sel = document.createElement("select");
  for (const [value, text] of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    sel.appendChild(opt);
  }
  return sel;
}

/**
 * One business row: plan change, impersonation and the platform-owner-only
 * wallet-broadcast policy.
 * @param {SuperPageContext} ctx
 * @param {SuperBusinessRow} business
 * @param {{ plans: ReturnType<typeof import("./plans.js").createPlans>, reloadBusinesses: () => Promise<void> }} deps
 */
export function renderBusinessCard(ctx, business, { plans, reloadBusinesses }) {
  const { api, toast, run } = ctx;
  const card = document.createElement("div");
  card.className = "card compact-card mb-8";

  const title = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = business.name || "Negocio";
  const slug = document.createElement("span");
  slug.className = "small";
  slug.textContent = ` (${business.slug || "-"})`;
  title.append(strong, slug);
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "small";
  meta.textContent = `Plan actual: ${business.plan} • Clientes: ${business.customers} • Staff: ${business.staff}`;
  card.appendChild(meta);

  const planInfo = document.createElement("div");
  planInfo.className = "small mt-6 pre-wrap";
  planInfo.textContent = plans.planSummaryText(business.plan);
  card.appendChild(planInfo);

  const row = document.createElement("div");
  row.className = "row mt-8";

  const planSel = plans.makePlanSelect(business.plan);
  planSel.addEventListener("change", () => {
    planInfo.textContent = plans.planSummaryText(planSel.value);
  });
  row.appendChild(planSel);

  const savePlanBtn = document.createElement("button");
  savePlanBtn.textContent = "Guardar plan";
  savePlanBtn.addEventListener("click", async () => {
    await run(
      async () => {
        await api(`/api/super/businesses/${encodeURIComponent(business.id)}/plan`, {
          method: "PUT",
          body: JSON.stringify({ plan: planSel.value }),
        });
        toast(`Plan actualizado a ${planSel.value}.`);
        await reloadBusinesses();
      },
      (error) => {
        toast("No se pudo actualizar plan: " + error.message);
      },
    );
  });
  row.appendChild(savePlanBtn);

  const impersonateBtn = document.createElement("button");
  impersonateBtn.className = "primary";
  impersonateBtn.textContent = "Impersonar";
  impersonateBtn.addEventListener("click", async () => {
    await run(
      async () => {
        await api(`/api/super/impersonate/${encodeURIComponent(business.id)}`, {
          method: "POST",
          body: "{}",
        });
        toast("Impersonación lista. Abriendo el panel del negocio...");
        setTimeout(() => {
          location.href = "/negocio/";
        }, 500);
      },
      (error) => {
        toast("No se pudo impersonar: " + error.message);
      },
    );
  });
  row.appendChild(impersonateBtn);

  card.appendChild(row);

  // Wallet broadcast: platform-owner-only opt-in + channel policy. Merchants have
  // no such control; this governs the shared Apple/Google wallet account for this business.
  const wb = business.wallet_broadcast || {
    enabled: false,
    channelPolicy: "wallet_first_sms_fallback",
  };
  const wbRow = document.createElement("div");
  wbRow.className = "row mt-8";
  const wbLabel = document.createElement("span");
  wbLabel.className = "small";
  wbLabel.textContent = "Difusión por billetera:";
  wbRow.appendChild(wbLabel);

  const wbEnabled = makeSelect(BROADCAST_STATES);
  wbEnabled.value = wb.enabled ? "on" : "off";
  wbRow.appendChild(wbEnabled);

  const wbPolicy = makeSelect(BROADCAST_POLICIES);
  wbPolicy.value = wb.channelPolicy || "wallet_first_sms_fallback";
  wbRow.appendChild(wbPolicy);

  const wbSave = document.createElement("button");
  wbSave.textContent = "Guardar billetera";
  wbSave.addEventListener("click", async () => {
    await run(
      async () => {
        await api(`/api/super/businesses/${encodeURIComponent(business.id)}/wallet-broadcast`, {
          method: "PUT",
          body: JSON.stringify({
            enabled: wbEnabled.value === "on",
            channel_policy: wbPolicy.value,
          }),
        });
        toast("Difusión por billetera actualizada.");
        await reloadBusinesses();
      },
      (error) => {
        toast("No se pudo actualizar difusión por billetera: " + error.message);
      },
    );
  });
  wbRow.appendChild(wbSave);
  card.appendChild(wbRow);
  return card;
}
