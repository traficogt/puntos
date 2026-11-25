import { withDbClientContext } from "../../database.js";
import { MobilePushRepo } from "../../repositories/mobile-push-repository.js";
import { getCustomerRewardProgress } from "../customer-reward-progress.js";
import { PlanConfigService } from "../plan-config-service.js";
import { logger } from "../../../utils/logger.js";
import { loadMobilePushConfig } from "./config.js";
import { createApnsProvider } from "./apns.js";
import { createMobilePushService } from "./service.js";

export const mobilePushSettings = loadMobilePushConfig();
/** @type {ReturnType<typeof createApnsProvider> | undefined} */
let provider;
if (mobilePushSettings.ready) {
  try {
    // ready implies config (loadMobilePushConfig).
    provider = createApnsProvider(
      /** @type {import("./config.js").MobilePushConfig} */ (mobilePushSettings.config),
    );
  } catch {
    mobilePushSettings.ready = false;
    mobilePushSettings.errors.push("APNS_INITIALIZATION_FAILED");
  }
}
if (mobilePushSettings.enabled && !mobilePushSettings.ready)
  logger.warn(
    { issues: mobilePushSettings.errors },
    "Mobile push disabled: incomplete configuration",
  );
export const mobilePushService = createMobilePushService({
  repo: MobilePushRepo,
  provider,
  settings: mobilePushSettings,
  planConfigService: PlanConfigService,
  getRewardProgress: (/** @type {{ businessId: string, customerId: string }} */ identity) =>
    withDbClientContext(
      { platformAdmin: false, tenantId: identity.businessId },
      (/** @type {import("../customer-reward-progress.js").TxClient} */ client) =>
        getCustomerRewardProgress(client, identity),
    ),
  globalContext: (fn) => withDbClientContext({ platformAdmin: true, tenantId: null }, fn),
});
let running = false;
export async function processMobilePushUpdates() {
  if (running) return;
  running = true;
  try {
    const result = await mobilePushService.processDue();
    if (result.failed) logger.warn(result, "Mobile push updates deferred");
  } catch {
    logger.warn("Mobile push update loop could not complete");
  } finally {
    running = false;
  }
}
export function closeMobilePush() {
  provider?.close();
}
