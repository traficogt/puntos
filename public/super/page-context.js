/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperPageDependencies} SuperPageDependencies */
/** @typedef {import("./types.js").SuperPageState} SuperPageState */

/**
 * Mutable page state shared by the super-console modules.
 * @returns {SuperPageState}
 */
function createSuperState() {
  return {
    planList: [],
    businessList: [],
    magicActorRows: [],
    sessionGeneration: 0,
    logoutPending: false,
    sessionActionInProgress: false,
  };
}

/**
 * @param {SuperPageDependencies} deps
 * @returns {SuperPageContext}
 */
export function createSuperContext({ api, $, toast }) {
  return {
    api,
    $,
    toast,
    state: createSuperState(),
    element: (selector) => /** @type {HTMLElement} */ ($(selector)),
    input: (selector) => /** @type {HTMLInputElement} */ ($(selector)),
    select: (selector) => /** @type {HTMLSelectElement} */ ($(selector)),
    async run(task, onError) {
      try {
        return await task();
      } catch (error) {
        if (onError) {
          return onError(error instanceof Error ? error : new Error(String(error)));
        }
        return null;
      }
    },
  };
}
