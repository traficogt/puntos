import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('wallet readiness CLI loads local dotenv settings without overriding explicit provider disablement', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'puntos-wallet-doctor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A local fixture; no real provider configuration is read or contacted.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(path.join(directory, '.env'), 'APPLE_WALLET_ENABLED=true\nGOOGLE_WALLET_ENABLED=true\n');
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../src/scripts/wallet-doctor.mjs', import.meta.url))], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'test', APPLE_WALLET_ENABLED: 'false', GOOGLE_WALLET_ENABLED: 'false' },
    encoding: 'utf8'
  });
  const report = JSON.parse(output);
  assert.deepEqual(report.apple, { enabled: false, locallyReady: false, issues: [] });
  assert.deepEqual(report.google, { enabled: false, locallyReady: false, issues: [] });
});
