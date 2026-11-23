/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */
/** @typedef {import("./types.js").StaffPageDependencies} StaffPageDependencies */
/** @typedef {import("./types.js").StaffPageState} StaffPageState */

export const SELECTION_PROMPT_COPY = "Escanea o ingresa el código del cliente para continuar.";

/**
 * Mutable page state shared by the staff modules. Each module owns a slice; the
 * object exists so the modules can read each other's facts without closures over
 * dozens of loose variables.
 * @returns {StaffPageState}
 */
function createStaffState() {
  return {
    staff: null,
    protectedCycle: null,
    scanning: false,
    lastCustomerId: null,
    lastCustomerToken: "",
    lastCashbackBalance: 0,
    lastCustomerPoints: 0,
    customerSelectionRevision: 0,
    awardInFlight: false,
    unverifiedSelection: false,
    storageFailed: false,
    sessionEnded: false,
    sessionOnline: false,
    offlineGrant: null,
    programRule: null,
    rewardOptions: [],
    permissionSet: null,
    planFeatures: {},
    lastCustomerMovement: "Sin movimientos recientes",
    mounts: {
      serviceCases: null,
      rewardEntitlements: null,
      posRecording: null,
      serviceBriefing: null,
      demandNotebook: null,
    },
  };
}

/**
 * @param {StaffPageDependencies} deps
 * @returns {StaffPageContext}
 */
export function createStaffContext({ api, $, toast, uuidv4 }) {
  return {
    api,
    $,
    toast,
    uuidv4,
    state: createStaffState(),
    element: (selector) => /** @type {HTMLElement} */ ($(selector)),
    input: (selector) => /** @type {HTMLInputElement} */ ($(selector)),
    select: (selector) => /** @type {HTMLSelectElement} */ ($(selector)),
    async run(task, onError) {
      try {
        return await task();
      } catch (error) {
        if (onError) return onError(error);
        return null;
      }
    },
  };
}
