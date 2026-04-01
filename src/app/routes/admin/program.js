import { Router } from "express";
import { registerProgramConfigRoutes } from "./program-config-routes.js";
import { registerProgramCampaignRoutes } from "./program-campaign-routes.js";
import { registerProgramExternalRoutes } from "./program-external-routes.js";

export const adminProgramRoutes = Router();

registerProgramConfigRoutes(adminProgramRoutes);
registerProgramCampaignRoutes(adminProgramRoutes);
registerProgramExternalRoutes(adminProgramRoutes);
