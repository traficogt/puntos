import { isStrongPassword, passwordRequirementsText } from "/lib.js";
import { renderBusinessCard } from "./business-card.js";

/** @typedef {import("./types.js").SuperBusinessCreateResponse} SuperBusinessCreateResponse */
/** @typedef {import("./types.js").SuperBusinessRow} SuperBusinessRow */
/** @typedef {import("./types.js").SuperBusinessUserCreateResponse} SuperBusinessUserCreateResponse */
/** @typedef {import("./types.js").SuperBusinessesResponse} SuperBusinessesResponse */
/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */

/**
 * Business directory plus the two creation forms (business, business user).
 * @param {SuperPageContext} ctx
 * @param {{ plans: ReturnType<typeof import("./plans.js").createPlans>, magicLinks: ReturnType<typeof import("./magic-links.js").createMagicLinks> }} deps
 */
export function createBusinesses(ctx, { plans, magicLinks }) {
  const { api, $, toast, state, run, element, input, select } = ctx;

  async function loadBusinesses() {
    await run(
      async () => {
        const out = /** @type {SuperBusinessesResponse} */ (
          await api("/api/super/businesses?limit=200")
        );
        const rows = /** @type {SuperBusinessRow[]} */ (out.businesses || []);
        state.businessList = rows;
        const box = element("#businesses");
        box.replaceChildren();
        if (!rows.length) {
          box.textContent = "No hay negocios.";
          magicLinks.renderMagicBusinessOptions();
          await magicLinks.loadMagicActors();
          return;
        }

        rows.forEach((business) => {
          box.appendChild(
            renderBusinessCard(ctx, business, { plans, reloadBusinesses: loadBusinesses }),
          );
        });

        const userBizSel = /** @type {HTMLSelectElement | null} */ ($("#newUserBusiness"));
        if (userBizSel) {
          userBizSel.replaceChildren();
          rows.forEach((business) => {
            const opt = document.createElement("option");
            opt.value = business.id;
            opt.textContent = `${business.name} (${business.slug})`;
            userBizSel.appendChild(opt);
          });
        }
        magicLinks.renderMagicBusinessOptions();
        await magicLinks.loadMagicActors();
      },
      (error) => {
        toast("Error cargando negocios: " + error.message);
      },
    );
  }

  async function createBusiness() {
    await run(
      async () => {
        const payload = {
          businessName: input("#newBusinessName").value.trim(),
          email: input("#newBusinessEmail").value.trim(),
          phone: input("#newBusinessPhone").value.trim() || undefined,
          password: input("#newBusinessPassword").value,
          category: input("#newBusinessCategory").value,
          plan: select("#newBusinessPlan").value,
        };
        if (!isStrongPassword(payload.password)) {
          return toast(passwordRequirementsText());
        }
        const out = /** @type {SuperBusinessCreateResponse} */ (
          await api("/api/super/businesses", { method: "POST", body: JSON.stringify(payload) })
        );
        toast(`Negocio creado: ${out.business?.name || "OK"}`);
        input("#newBusinessName").value = "";
        input("#newBusinessEmail").value = "";
        input("#newBusinessPhone").value = "";
        input("#newBusinessPassword").value = "";
        await loadBusinesses();
      },
      (error) => {
        toast("No se pudo crear negocio: " + error.message);
      },
    );
  }

  async function createBusinessUser() {
    await run(
      async () => {
        const businessId = select("#newUserBusiness").value;
        if (!businessId) return toast("Selecciona un negocio.");
        const payload = {
          name: input("#newUserName").value.trim(),
          email: input("#newUserEmail").value.trim(),
          phone: input("#newUserPhone").value.trim() || undefined,
          role: select("#newUserRole").value,
          password: input("#newUserPassword").value,
        };
        if (!isStrongPassword(payload.password)) {
          return toast(passwordRequirementsText());
        }
        const out = /** @type {SuperBusinessUserCreateResponse} */ (
          await api(`/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
            method: "POST",
            body: JSON.stringify(payload),
          })
        );
        toast(`Usuario creado: ${out.user?.email || "OK"}`);
        input("#newUserName").value = "";
        input("#newUserEmail").value = "";
        input("#newUserPhone").value = "";
        input("#newUserPassword").value = "";
        element("#newUserHint").textContent =
          `Último creado: ${out.user?.name || ""} (${out.user?.role || ""})`;
        await loadBusinesses();
      },
      (error) => {
        toast("No se pudo crear usuario: " + error.message);
      },
    );
  }

  function bind() {
    element("#btnCreateBusiness").addEventListener("click", createBusiness);
    element("#btnCreateBusinessUser").addEventListener("click", createBusinessUser);
  }

  return { bind, loadBusinesses };
}
