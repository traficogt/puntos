import { mountRewardEntitlements } from "./reward-entitlements.js";
import { mountPosRecording } from "./pos-recording.js";
import { mountServiceCases } from "./service-cases.js";
import { mountDemandNotebook } from "../demand-notebook.js";
import { mountOwnerOperations } from "./owner-operations.js";
import { mountServiceBriefing } from "./service-briefing.js";

/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Secondary panels mounted once the session is valid; they read the selected
 * customer through `getContext` and are torn down when the session is blocked.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, surface: ReturnType<typeof import("./customer-surface.js").createCustomerSurface>, rules: ReturnType<typeof import("./program-rules.js").createProgramRules> }} deps
 */
export function createServiceMounts(ctx, { session, surface, rules }) {
  const { api, state, element, select } = ctx;
  const { mounts } = state;

  function mountAll() {
    mounts.posRecording = mountPosRecording({
      container: element("#staffPosRecording"),
      api,
      getContext: () => ({
        customerId: state.lastCustomerId,
        staffId: state.staff?.id,
        businessId: state.staff?.business_id,
        branchId: state.staff?.branch_id,
        online: session.canUseRedeemFlow() && !state.sessionEnded,
      }),
    });
    mounts.rewardEntitlements = mountRewardEntitlements({
      container: element("#staffRewardEntitlements"),
      api,
      getContext: () => ({
        customerId: state.lastCustomerId,
        online: state.sessionOnline && !state.sessionEnded,
      }),
      onCycle: (cycle) => {
        state.protectedCycle = cycle;
        rules.renderProgramInfo();
        rules.updateInputsForRule();
      },
      onBalance: (balance) => {
        state.lastCustomerPoints = Number(balance);
        surface.renderRewardOptions();
        surface.updateCustomerSurfaceState();
      },
      onRedeemed: (result) => mounts.posRecording?.showRedemption(result),
    });
    mounts.serviceCases = mountServiceCases({
      container: element("#staffServiceCases"),
      api,
      getContext: () => ({
        customerId: state.lastCustomerId,
        rewardId: select("#rewardSelect").value,
        online: state.sessionOnline && !state.sessionEnded,
      }),
    });
    const operationsContainer = document.createElement("section"),
      demandContainer = document.createElement("section");
    element("#staffServiceBriefing").after(operationsContainer, demandContainer);
    mountOwnerOperations(operationsContainer, api);
    mounts.demandNotebook = mountDemandNotebook({
      container: demandContainer,
      source: "staff",
      getContext: () => ({
        customerId: state.lastCustomerId,
        rewardId: select("#rewardSelect").value || null,
      }),
    });
    mounts.serviceBriefing = mountServiceBriefing({
      container: element("#staffServiceBriefing"),
      api,
      program: state.programRule,
    });
  }

  function destroyAll() {
    mounts.serviceCases?.destroy();
    mounts.rewardEntitlements?.destroy();
    mounts.posRecording?.destroy();
    mounts.serviceBriefing?.destroy();
    mounts.demandNotebook?.destroy();
  }

  return { destroyAll, mountAll };
}
