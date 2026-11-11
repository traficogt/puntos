import {rewardWorkspaceRoutes} from './reward-workspace-routes.js';
import {merchantCatalogRoutes} from './merchant-catalog-routes.js';
import {posCheckoutRoutes} from './pos-checkout-routes.js';
import {redemptionPosRoutes} from "./redemption-pos-routes.js";
import { activationInsightsRoutes } from "./activation-insights-routes.js";
import { merchantRegionRoutes } from "./merchant-region-routes.js";
import { customerImportJobRoutes } from "./customer-import-job-routes.js";
import { rewardPromiseRoutes } from "./reward-promise-routes.js";
import { hospitalityRoutes } from "./hospitality-routes.js";
import { odooConnectorRoutes } from "./odoo-connector-routes.js";
import { transactionExplanationRoutes } from "./transaction-explanation-routes.js";
import { staffDelegationRoutes } from "./staff-delegation-routes.js";
import { createServiceRecoveryRoutes } from "./service-recovery-routes.js";
import { merchantDecisionsRoutes } from "./merchant-decisions-routes.js";
const serviceRecoveryRoutes = createServiceRecoveryRoutes();
import { createCustomerAudienceRouter } from "./customer-audience-routes.js";
import { customerMigrationRoutes } from "./admin/customer-migration-routes.js";
import { createMerchantLaunchRoutes } from "./merchant-launch-routes.js";
import { createAutomationControlsRoutes } from "./automation-controls-routes.js";
import { createRewardEconomicsRoutes } from "./reward-economics-routes.js";
import { adminAcquisitionRoutes } from "./admin/acquisition-routes.js";
import { acquisitionPublicRoutes } from "./acquisition-public-routes.js";
import { createMerchantPilotRoutes } from "./merchant-pilot-routes.js";
import { merchantOperationsRoutes } from "./merchant-operations-routes.js";
import { createGrowthCampaignRouter, createCustomerGrowthOffersRouter } from "./growth-campaign-routes.js";
import { createGrowthMessagingRoutes } from "./growth-messaging-routes.js";
import { adminBrandedQrRoutes } from "./admin/branded-qr-routes.js";
import { Router } from "express";
import { healthRoutes } from "./health-routes.js";
import { publicRoutes } from "./public-routes.js";
import { staffRoutes } from "./staff-routes.js";
import { adminRoutes } from "./admin-routes.js";
import { nativeWalletRoutes } from "./native-wallet-routes.js";
import { mobileRoutes } from "./mobile-routes.js";
import { customerRoutes } from "./customer-routes.js";
import tierRoutes from "./tier-routes.js";
import referralRoutes from "./referral-routes.js";
import gamificationRoutes from "./gamification-routes.js";
import analyticsRoutes from "./analytics-routes.js";
import { superRoutes } from "./super-routes.js";
import { superMagicLinkRoutes } from "./super-magic-link-routes.js";
import { paymentWebhookRoutes } from "./payment-webhook-routes.js";
import { posRoutes } from "./pos-routes.js";
import { adminPosRoutes } from "./admin/pos-routes.js";
import { orderRoutes } from "./order-routes.js";
import { orderReturnRoutes } from "./order-return-routes.js";
import { contactSyncRoutes } from "./contact-sync-routes.js";
import giftCardRoutes from "./gift-card-routes.js";
import docsRoutes from "./docs-routes.js";
import swaggerRoutes from "./swagger-routes.js";

import { createReferralGrowthRoutes } from "./referral-growth-routes.js";
import { posOnboardingRoutes } from "./admin/pos-onboarding-routes.js";

export const apiRoutes = Router();
const referralGrowthRoutes = createReferralGrowthRoutes();
const growthCampaignRoutes = createGrowthCampaignRouter();
const customerGrowthOffersRoutes = createCustomerGrowthOffersRouter();
const growthMessagingRoutes = createGrowthMessagingRoutes();
const merchantPilotRoutes = createMerchantPilotRoutes();
const merchantLaunchRoutes = createMerchantLaunchRoutes();
const customerAudienceRoutes = createCustomerAudienceRouter();
const automationControlsRoutes = createAutomationControlsRoutes();
const rewardEconomicsRoutes = createRewardEconomicsRoutes();

// Explicit mount metadata keeps OpenAPI discovery independent of Express's
// private path matcher representation.
export const apiRouteMounts = [];
function mountApiRoute(basePath, router) {
  apiRouteMounts.push({ basePath, router });
  apiRoutes.use(basePath, router);
}

const mountRoutes = (basePath) => {
  mountApiRoute(basePath, healthRoutes);
  mountApiRoute(basePath, merchantCatalogRoutes);
  mountApiRoute(basePath, rewardWorkspaceRoutes);
  mountApiRoute(basePath, posCheckoutRoutes);
  mountApiRoute(basePath, redemptionPosRoutes);
  mountApiRoute(basePath, activationInsightsRoutes);
  mountApiRoute(basePath, merchantRegionRoutes);
  mountApiRoute(basePath, customerImportJobRoutes);
  mountApiRoute(basePath, rewardPromiseRoutes);
  mountApiRoute(basePath, hospitalityRoutes);
  mountApiRoute(basePath, odooConnectorRoutes);

  mountApiRoute(basePath, merchantPilotRoutes);
  mountApiRoute(basePath, merchantLaunchRoutes);
  mountApiRoute(basePath, customerMigrationRoutes);
  mountApiRoute(basePath, customerAudienceRoutes);
  mountApiRoute(basePath, automationControlsRoutes);
  mountApiRoute(basePath, rewardEconomicsRoutes);
  mountApiRoute(basePath, adminAcquisitionRoutes);
  mountApiRoute(basePath, acquisitionPublicRoutes);
  mountApiRoute(basePath, merchantOperationsRoutes);
  mountApiRoute(basePath, transactionExplanationRoutes);
  mountApiRoute(basePath, staffDelegationRoutes);
  mountApiRoute(basePath, serviceRecoveryRoutes);
  mountApiRoute(basePath, merchantDecisionsRoutes);
  mountApiRoute(basePath, adminBrandedQrRoutes);
  mountApiRoute(basePath, growthCampaignRoutes);
  mountApiRoute(basePath, customerGrowthOffersRoutes);
  mountApiRoute(basePath, growthMessagingRoutes);
  mountApiRoute(basePath, publicRoutes);
  mountApiRoute(basePath, staffRoutes);
  mountApiRoute(basePath, adminRoutes);
  mountApiRoute(basePath, customerRoutes);
  mountApiRoute(basePath, mobileRoutes);
  mountApiRoute(basePath, nativeWalletRoutes);
  mountApiRoute(basePath, tierRoutes);
  mountApiRoute(basePath, referralRoutes);
  mountApiRoute(basePath, gamificationRoutes);
  mountApiRoute(basePath, analyticsRoutes);
  mountApiRoute(basePath, superRoutes);
  mountApiRoute(basePath, superMagicLinkRoutes);
  mountApiRoute(basePath, paymentWebhookRoutes);
  mountApiRoute(basePath, posRoutes);
  mountApiRoute(basePath, adminPosRoutes);
  mountApiRoute(basePath, posOnboardingRoutes);
  mountApiRoute(basePath, referralGrowthRoutes);
  mountApiRoute(basePath, orderRoutes);
  mountApiRoute(basePath, orderReturnRoutes);
  mountApiRoute(basePath, contactSyncRoutes);
  mountApiRoute(basePath, giftCardRoutes);
};

// Preferred, versioned path
mountRoutes("/api/v1");
// Legacy, unversioned path kept for backward compatibility
mountRoutes("/api");

// OpenAPI specification (covers both /api and /api/v1)
apiRoutes.use(docsRoutes);
// Swagger UI
apiRoutes.use(swaggerRoutes);
