import { Router } from "express";
import { gamificationCustomerRoutes } from "./gamification-customer-routes.js";
import { gamificationAdminRoutes } from "./gamification-admin-routes.js";

const router = Router();

router.use(gamificationCustomerRoutes);
router.use(gamificationAdminRoutes);

export default router;
