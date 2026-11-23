import { registerServiceWorker } from "/lib.js";
import { createPlatformHealth } from "./operations-health.js";
import { createSuperContext } from "./page-context.js";
import { createSuperSession } from "./session.js";
import { createPlans } from "./plans.js";
import { createOwnerProgressSettings } from "./owner-progress-settings.js";
import { createMagicLinks } from "./magic-links.js";
import { createBusinesses } from "./businesses.js";
import { createSecurityPosture } from "./security-posture.js";
import { bindAccountSecurity } from "./account-security.js";

/** @typedef {import("./types.js").SuperPageDependencies} SuperPageDependencies */

/**
 * Composition root of the super console. Modules share one state object (see
 * page-context.js); the session module decides when private data may load.
 * @param {SuperPageDependencies} deps
 */
export async function initSuperPage({ api, $, toast }) {
  const ctx = createSuperContext({ api, $, toast });
  const { state } = ctx;
  const platformHealth = createPlatformHealth({
    container: $("#salud"),
    api,
    currentSession: () => state.sessionGeneration,
  });
  const plans = createPlans(ctx, { reloadBusinesses: () => businesses.loadBusinesses() });
  const ownerProgress = createOwnerProgressSettings(ctx);
  const magicLinks = createMagicLinks(ctx);
  const businesses = createBusinesses(ctx, { plans, magicLinks });
  const posture = createSecurityPosture(ctx, {
    reloadBusinesses: () => businesses.loadBusinesses(),
  });
  const session = createSuperSession(ctx, {
    platformHealth,
    loadPrivateData: async (current) => {
      await plans.loadPlans();
      if (!current()) return;
      plans.renderPlanMatrix();
      await ownerProgress.load();
      if (!current()) return;
      ownerProgress.render();
      await posture.loadSecurityPosture();
      if (!current()) return;
      await businesses.loadBusinesses();
      if (!current()) return;
      await platformHealth.load();
    },
  });

  session.bind();
  posture.bind();
  bindAccountSecurity(ctx, { loadMe: session.loadMe });
  businesses.bind();
  magicLinks.bind();

  await session.start();
  registerServiceWorker().catch(() => {});
}
