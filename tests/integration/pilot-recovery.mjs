import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { dbQuery, withDbClientContext, closeDatabase } from '../../src/app/database.js';

if (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'puntos_e2e') throw new Error('Requires the disposable puntos_e2e database');
const base = process.env.TEST_API_URL || 'http://api:3001';
if (!['api', 'localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only isolated local API allowed');
const jar = new Map();
const ip = `198.51.100.${20 + Math.floor(Math.random() * 200)}`;
async function request(path, body, cookies = jar) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: base, cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') };
  if (cookies.get('pf_csrf_readable')) headers['x-csrf-token'] = decodeURIComponent(cookies.get('pf_csrf_readable'));
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const item of res.headers.getSetCookie()) { const [k, ...v] = item.split(';')[0].split('='); cookies.set(k, v.join('=')); }
  return { status: res.status, data: await res.json() };
}
function ok(result, label) { assert.equal(result.status, 200, `${label}: ${JSON.stringify(result.data)}`); return result.data; }
try {
  await request('/api/health');
  const suffix = randomUUID().slice(0, 8);
  const signup = ok(await request('/api/admin/signup', { businessName: `Pilot recovery ${suffix}`, email: `pilot-${suffix}@example.com`, password: 'OrchardLanternMarble2026!' }), 'signup');
  const slug = signup.business?.slug || signup.slug;
  assert.ok(slug);
  const phone = `+50255${String(Math.floor(Math.random() * 1000000)).padStart(6,'0')}`;
  const joinPath = `/api/public/business/${slug}/join`;
  const code = ok(await request(`${joinPath}/request-code`, { phone, name: 'Pilot recovery' }), 'OTP issue').dev_code;
  assert.ok(code, 'isolated delivery provider must return a dev code');
  assert.equal((await request(`${joinPath}/request-code`, { phone })).status, 429, 'OTP issue cooldown persists');
  const verificationJars = [new Map(jar), new Map(jar)];
  const verifies = await Promise.all(verificationJars.map(cookies => request(`${joinPath}/verify`, { phone, code }, cookies)));
  assert.deepEqual(verifies.map(r=>r.status).sort(), [200,400], 'OTP must only consume once concurrently');
  // Whichever verification won owns the session; obtain it from that request jar.
  const successIndex = verifies.findIndex(r=>r.status===200);
  const success = verifies[successIndex];
  jar.clear();
  for (const [key, value] of verificationJars[successIndex]) jar.set(key, value);
  if (!(await request('/api/customer/me')).data.customer) throw new Error('Primary verification must retain its customer session');
  assert.ok(success.data.ok);
  const me = ok(await request('/api/customer/me'), 'customer');
  const businessId = me.business.id;
  const grant = ok(await request('/api/staff/offline-grant'), 'offline grant').grant;
  const onlineQr = ok(await request('/api/public/customer/qr', {}), 'online QR').token;
  const online = { txId: randomUUID(), customerQrToken: onlineQr, amount_q: 50 };
  ok(await request('/api/staff/award', online), 'initial award');
  const offlineQr = ok(await request('/api/public/customer/qr', {}), 'offline QR').token;
  const capturedAt = new Date().toISOString();
  const offline = { txId: randomUUID(), customerQrToken: offlineQr, amount_q: 60, client_ts: capturedAt, offlineGrant: grant };
  console.log('OTP atomic consumption, cooldown and initial real ledger write passed; waiting for actual QR expiry.');
  await delay(62000);
  const recovered = ok(await request('/api/staff/sync', { awards: [offline, { ...online, client_ts: capturedAt }] }), 'late sync');
  assert.equal(recovered.results.length, 2);
  assert.ok(recovered.results.every(r=>r.ok), JSON.stringify(recovered.results));
  const repeated = ok(await request('/api/staff/sync', { awards: [offline] }), 'repeated sync');
  assert.equal(repeated.results[0].ok, true);
  const conflict = ok(await request('/api/staff/sync', { awards: [{ ...offline, amount_q: 61 }] }), 'changed retry');
  assert.equal(conflict.results[0].ok, false);
  const noGrant = ok(await request('/api/staff/sync', { awards: [{ ...offline, txId: randomUUID(), offlineGrant: undefined }] }), 'expired without grant');
  assert.equal(noGrant.results[0].ok, false);
  const tooMany = await request('/api/staff/sync', { awards: new Array(201).fill(offline) });
  assert.equal(tooMany.status, 400);
  const { rows } = await withDbClientContext({ tenantId: businessId, platformAdmin: false }, () => dbQuery('SELECT id, count(*)::int AS count FROM transactions WHERE id=ANY($1::uuid[]) GROUP BY id', [[online.txId, offline.txId]]));
  assert.equal(rows.length, 2); assert.ok(rows.every(row=>row.count===1));
  ok(await request('/api/staff/logout', {}), 'logout');
  assert.equal((await request('/api/staff/sync', { awards: [offline] })).status, 401, 'logged-out staff cannot sync');
  console.log('PASS: actual expired QR + signed grant, lost-response replay, repeated recovery, altered payload rejection, unsigned late rejection, batch limits, exactly-once ledger, revoked session.');
} finally { await closeDatabase(); }
