import { getRegistry } from "../../middleware/metrics.js";
import { redisHealth } from "../services/job-service.js";
import { createObservabilityRouter } from "./observability-router.js";

export default createObservabilityRouter({
  getPromMetrics: async () => getRegistry().metrics(),
  getQueueHealth: redisHealth,
  includeQueueHealth: true,
  includeBillingMetrics: true,
  includeQueueMetrics: true,
  includeBackgroundJobMetrics: true
});
