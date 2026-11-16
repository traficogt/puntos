import { assertFailureFixtureEnvironment } from './failure-fixture.js';

assertFailureFixtureEnvironment();
globalThis.fetch = async () => { throw new Error('Live HTTP is disabled in failure fixtures'); };
const { closeDatabase } = await import('../../../src/app/database.js');
try {
  const { processPendingJobsOnce } = await import('../../../src/app/services/job-service.js');
  await processPendingJobsOnce({ limit: 1 });
} finally {
  await closeDatabase();
}
