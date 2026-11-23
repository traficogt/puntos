import {
  clearWalletView,
  getCustomerEpoch,
  getCustomerIdentity,
  invalidateCustomerIdentity,
  isCustomerAuthError,
  onCustomerViewClear,
} from "./session.js";
/**
 * Controller handed back by mountDemandNotebook (kept structural: tests rewrite this
 * module's import specifiers by string, so no import() type may name that module).
 * @typedef {{
 *   ready: Promise<void>,
 *   refresh: () => Promise<void>,
 *   setPaused: (value: boolean) => void,
 *   destroy: () => void,
 * }} DemandNotebookController
 */
/**
 * @typedef {{
 *   owner: string,
 *   epoch: ReturnType<typeof getCustomerEpoch>,
 *   container: Element,
 *   api: typeof import("/lib.js").api,
 *   isCurrent: () => boolean,
 *   paused: boolean,
 *   controller: DemandNotebookController | null,
 * }} MountedDemand
 */
/** @type {MountedDemand | null} */
let mounted = null;
let version = 0;
export function clearCustomerDemand() {
  version++;
  mounted?.controller?.destroy();
  mounted = null;
}
/** @param {{ businessId: string, customerId: string } | null} [identity] */
export function pauseCustomerDemand(identity = null) {
  if (
    mounted &&
    (mounted.epoch !== getCustomerEpoch() ||
      (identity && mounted.owner !== JSON.stringify([identity.businessId, identity.customerId])))
  )
    return clearCustomerDemand();
  if (mounted) {
    mounted.paused = true;
    mounted.controller?.setPaused(true);
  }
}
onCustomerViewClear(clearCustomerDemand);
/**
 * @param {{
 *   api: typeof import("/lib.js").api,
 *   $: (selector: string) => HTMLElement | null,
 *   isCurrent: () => boolean,
 *   identity?: { businessId: string, customerId: string } | null,
 * }} deps
 */
export async function loadCustomerDemand({ api, $, isCurrent, identity = getCustomerIdentity() }) {
  const container = $("#customerDemand");
  if (!container || !isCurrent()) return;
  if (!identity?.businessId || !identity?.customerId) return clearCustomerDemand();
  const owner = JSON.stringify([identity.businessId, identity.customerId]);
  const epoch = getCustomerEpoch();
  if (
    mounted &&
    (mounted.owner !== owner || mounted.epoch !== epoch || mounted.container !== container)
  )
    clearCustomerDemand();
  if (mounted) {
    const record = mounted;
    record.api = api;
    record.isCurrent = isCurrent;
    await record.controller?.ready;
    if (record === mounted && isCurrent() && epoch === getCustomerEpoch()) {
      record.paused = false;
      record.controller?.setPaused(false);
      await record.controller?.refresh();
    }
    return;
  }
  const current = ++version;
  try {
    const { mountDemandNotebook } = await import("../demand-notebook.js");
    if (current !== version || !isCurrent()) return;
    /** @type {MountedDemand} */
    const record = { owner, epoch, container, api, isCurrent, paused: false, controller: null };
    mounted = record;
    const active = () => mounted === record && current === version && epoch === getCustomerEpoch();
    record.controller = mountDemandNotebook({
      container,
      source: "customer",
      request: async (path, options) => {
        if (!active() || record.paused || !record.isCurrent())
          throw new DOMException("La sesión cambió.", "AbortError");
        try {
          const result = await record.api(path, options);
          // A response already in flight still belongs to this session during a
          // background refresh. Identity changes or logout invalidate it.
          if (!active()) throw new DOMException("La sesión cambió.", "AbortError");
          return result;
        } catch (error) {
          if (active() && isCustomerAuthError(error)) {
            invalidateCustomerIdentity();
            clearWalletView($);
            const login = $("#needLogin");
            if (login) {
              login.hidden = false;
              login.classList.toggle("is-hidden", false);
            }
            const subtitle = $("#customerEntrySubtitle");
            if (subtitle)
              subtitle.textContent =
                "Tu sesión venció. Ingresa de nuevo para consultar tus pedidos.";
          }
          throw error;
        }
      },
    });
    await record.controller.ready;
  } catch {
    if (current === version && isCurrent()) {
      clearCustomerDemand();
      container.textContent =
        "No pudimos cargar tus pedidos. Actualiza la tarjeta para volver a intentar.";
    }
  }
}
