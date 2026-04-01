import { churnRepository } from "./analytics/churn-repository.js";
import { cohortRepository } from "./analytics/cohorts-repository.js";
import { rfmRepository } from "./analytics/rfm-repository.js";
import { segmentRepository } from "./analytics/segments-repository.js";

export { cohortSqlConfigForType } from "./analytics/cohorts-repository.js";

export const AnalyticsRepository = {
  ...rfmRepository,
  ...churnRepository,
  ...segmentRepository,
  ...cohortRepository
};
