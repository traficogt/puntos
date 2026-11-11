import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSession, getBrowserSession, hashSessionToken } from '../../src/app/services/auth-session-service.js';
test('session creation accepts an existing transaction executor and never persists to the test memory store', async () => {
  const statements = [];
  const result = await createBrowserSession({ actorType: 'CUSTOMER', actorId: 'customer-a', businessId: 'business-a' }, async (sql, args) => { statements.push({ sql, args }); return { rows: [] }; });
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /INSERT INTO auth_sessions/);
  assert.equal(statements[0].args[1], hashSessionToken(result.token));
  assert.equal(statements[0].args[3], 'customer-a');
  assert.equal(statements[0].args[5], 'business-a');
  assert.equal(await getBrowserSession(result.token), null);
});
