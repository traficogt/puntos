import { readFile } from 'node:fs/promises';
// Upgrade minimal older test fixtures to the new service schema. Real installs
// already have background jobs and both message outboxes before this migration.
export async function applyCampaignExpansionFixture(db, { allowClockFixture = false } = {}) {
  await db.query(`CREATE TABLE IF NOT EXISTS background_jobs(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),job_type text,status text DEFAULT 'QUEUED',payload jsonb,result jsonb,error text,attempts int DEFAULT 0,run_after timestamptz DEFAULT now(),locked_at timestamptz,started_at timestamptz,completed_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS lifecycle_message_outbox(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,status text,last_attempt_at timestamptz)`);
  for (const path of ['../../src/app/migrations/2026-11-10-growth-messaging.sql','../../src/app/migrations/2026-11-11-campaign-expansion.sql']) {
    // Fixed test migration paths, never external input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL(path,import.meta.url),'utf8'));
  }
  // Older lifecycle tests time-travel existing offers through SQL. Production
  // and expansion tests retain the new immutable terms guard.
  if (allowClockFixture) await db.query('ALTER TABLE growth_campaigns DISABLE TRIGGER growth_campaigns_terms_guard');
}
