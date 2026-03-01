import { getRegistry } from "../../middleware/metrics.js";
import { createObservabilityRouter } from "./observability-router.js";

export const healthRoutes = createObservabilityRouter({
  getPromMetrics: async () => getRegistry().metrics()
});
