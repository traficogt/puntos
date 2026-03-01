import { createAdminDashboardApp } from "./core.js";
import { registerProgramModule } from "./modules/program.js";
import { registerRewardsModule } from "./modules/rewards.js";
import { registerTiersModule } from "./modules/tiers.js";
import { registerGamificationModule } from "./modules/gamification.js";
import { registerReferralsModule } from "./modules/referrals.js";
import { registerBranchesModule } from "./modules/branches.js";
import { registerStaffModule } from "./modules/staff.js";
import { registerGiftCardsModule } from "./modules/giftcards.js";
import { registerOpsModule } from "./modules/ops.js";
import { registerAnalyticsModule } from "./modules/analytics.js";

/** @typedef {import("./types.js").AdminDashboardDependencies} AdminDashboardDependencies */

/**
 * @param {AdminDashboardDependencies} deps
 */
export async function initAdminDashboard({ api, $, toast, alert, confirm, prompt }) {
  const app = createAdminDashboardApp({ api, $, toast, alert, confirm, prompt });

  registerProgramModule(app);
  registerRewardsModule(app);
  registerTiersModule(app);
  registerGamificationModule(app);
  registerReferralsModule(app);
  registerBranchesModule(app);
  registerStaffModule(app);
  registerGiftCardsModule(app);
  registerOpsModule(app);
  registerAnalyticsModule(app);

  await app.start();
}
