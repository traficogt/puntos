import { Router } from "express";
import { healthRoutes } from "./health-routes.js";
import { publicRoutes } from "./public-routes.js";
import { staffRoutes } from "./staff-routes.js";
import { adminRoutes } from "./admin-routes.js";
import { customerRoutes } from "./customer-routes.js";
import tierRoutes from "./tier-routes.js";
import referralRoutes from "./referral-routes.js";
import gamificationRoutes from "./gamification-routes.js";
import analyticsRoutes from "./analytics-routes.js";
import { superRoutes } from "./super-routes.js";
import { paymentWebhookRoutes } from "./payment-webhook-routes.js";
import giftCardRoutes from "./gift-card-routes.js";
import docsRoutes from "./docs-routes.js";
import swaggerRoutes from "./swagger-routes.js";

export const apiRoutes = Router();

const mountRoutes = (basePath) => {
  apiRoutes.use(basePath, healthRoutes);
  apiRoutes.use(basePath, publicRoutes);
  apiRoutes.use(basePath, staffRoutes);
  apiRoutes.use(basePath, adminRoutes);
  apiRoutes.use(basePath, customerRoutes);
  apiRoutes.use(basePath, tierRoutes);
  apiRoutes.use(basePath, referralRoutes);
  apiRoutes.use(basePath, gamificationRoutes);
  apiRoutes.use(basePath, analyticsRoutes);
  apiRoutes.use(basePath, superRoutes);
  apiRoutes.use(basePath, paymentWebhookRoutes);
  apiRoutes.use(basePath, giftCardRoutes);
};

// Preferred, versioned path
mountRoutes("/api/v1");
// Legacy, unversioned path kept for backward compatibility
mountRoutes("/api");

// OpenAPI specification (covers both /api and /api/v1)
apiRoutes.use(docsRoutes);
// Swagger UI
apiRoutes.use(swaggerRoutes);
