import { registerServiceWorker } from "/lib.js";
import { createStaffContext } from "./page-context.js";
import { createStaffSession } from "./session.js";
import { createProgramRules } from "./program-rules.js";
import { createWalletPanel } from "./wallet-panel.js";
import { createCustomerSurface } from "./customer-surface.js";
import { createScanner } from "./scanner.js";
import { createAwardFlow } from "./award-flow.js";
import { createRedeemFlow } from "./redeem-flow.js";
import { bindWalletActions } from "./wallet-actions.js";
import { bindSecurityActions } from "./security-actions.js";
import { createServiceMounts } from "./service-mounts.js";

/** @typedef {import("./types.js").StaffPageDependencies} StaffPageDependencies */

/**
 * Composition root of the staff scanner page. Modules share one mutable state
 * object (see page-context.js); cross-module reactions that would otherwise be
 * circular (session → UI) are injected as hooks.
 * @param {StaffPageDependencies} deps
 */
export async function initStaffPage({ api, $, toast, uuidv4 }) {
  const ctx = createStaffContext({ api, $, toast, uuidv4 });
  const { state } = ctx;
  const rules = createProgramRules(ctx);
  const walletPanel = createWalletPanel(ctx);
  const session = createStaffSession(ctx, {
    renderProgramInfo: () => rules.renderProgramInfo(),
    updateInputsForRule: () => rules.updateInputsForRule(),
    applyUiPermissions: () => surface.applyUiPermissions(),
    clearSelectedCustomer: () => surface.clearSelectedCustomer(),
    stopCamera: () => scanner.stopCamera(),
    destroyMounts: () => mounts.destroyAll(),
  });
  const surface = createCustomerSurface(ctx, { session, rules, walletPanel });
  const scanner = createScanner(ctx, { session, surface });
  const awards = createAwardFlow(ctx, { session, surface });
  const redeem = createRedeemFlow(ctx, { session, surface });
  const mounts = createServiceMounts(ctx, { session, surface, rules });

  scanner.bind();
  awards.bind();
  session.bind();
  bindSecurityActions(ctx, { session });
  redeem.bind();
  bindWalletActions(ctx, { session, walletPanel });
  rules.bind();

  if (!(await session.ensureAuth())) return;
  try {
    await awards.prepareQueue();
  } catch {
    state.storageFailed = true;
    toast("El almacenamiento no está disponible. No registres ventas hasta recuperar la cola.");
  }
  surface.clearSelectedCustomer();
  if (navigator.onLine) {
    await redeem.loadRewards();
    await awards.requestSync();
  }

  mounts.mountAll();
  registerServiceWorker().catch(() => {});
}
