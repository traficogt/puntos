import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../src/config/index.js';
import { VerifyCodeRepo } from '../../src/app/repositories/verify-code-repository.js';
import { withDbClientContext, closeDatabase } from '../../src/app/database.js';

assert.equal(config.NODE_ENV, 'production');
assert.equal(config.DB_NAME, 'puntos_e2e', 'Only the disposable database is allowed');
assert.equal(config.DB_HOST, 'puntos-pilot-e2e-db-1');
const jar = new Map();
let secureStaffCookie = false, secureCustomerCookie = false;
async function request(path, body) {
 const headers = { 'content-type': 'application/json', host: 'pilot-app.test', origin: config.APP_ORIGIN, 'x-forwarded-proto': 'https', cookie: [...jar].map(([k,v])=>`${k}=${v}`).join('; ') };
 if(jar.has('pf_csrf_readable')) headers['x-csrf-token']=decodeURIComponent(jar.get('pf_csrf_readable'));
 const res=await fetch(`http://127.0.0.1:3001${path}`, {method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
 for(const cookie of res.headers.getSetCookie()) {
  const [k,...v]=cookie.split(';')[0].split('=');jar.set(k,v.join('='));
  if(k==='__Host-pf_staff') secureStaffCookie=/; Secure/.test(cookie)&&/; HttpOnly/.test(cookie);
  if(k==='__Host-pf_customer') secureCustomerCookie=/; Secure/.test(cookie)&&/; HttpOnly/.test(cookie);
 }
 return {status:res.status,data:await res.json()};
}
function ok(out,label){assert.equal(out.status,200,`${label}: ${JSON.stringify(out.data)}`);return out.data;}
try{
 ok(await request('/api/health'),'health');
 ok(await request('/api/ready'),'readiness');
 const suffix=randomUUID().slice(0,8);
 const created=ok(await request('/api/admin/signup',{businessName:`Production audit ${suffix}`,email:`production-${suffix}@example.invalid`,password:'OrchardLanternMarble2026!'}),'signup');
 assert.equal(secureStaffCookie,true);
 const business=created.business;
 const phone=`+50255${String(Math.floor(Math.random()*1000000)).padStart(6,'0')}`;
 const code='674391';
 await withDbClientContext({tenantId:business.id,platformAdmin:false},()=>VerifyCodeRepo.create({id:randomUUID(),business_id:business.id,phone:phone.replace(/\D/g,''),code_hash:bcrypt.hashSync(code,10),expires_at:new Date(Date.now()+600000)}));
 ok(await request(`/api/public/business/${business.slug}/join/verify`,{phone,code,name:'Isolated production check'}),'verify');
 assert.equal(secureCustomerCookie,true);
 const me=ok(await request('/api/customer/me'),'customer');assert.equal(me.business.id,business.id);
 const qr=ok(await request('/api/public/customer/qr',{}),'QR');
 const payload={customerQrToken:qr.token,txId:randomUUID(),amount_q:20};
 const earned=ok(await request('/api/staff/award',payload),'award');
 const replay=ok(await request('/api/staff/award',payload),'replay');assert.equal(replay.transactionId,earned.transactionId);assert.equal(replay.replay,true);
 assert.equal((await request('/api/staff/award',{...payload,amount_q:21})).status,409);
 assert.ok(ok(await request('/api/staff/offline-grant'),'offline grant').grant);
 assert.equal((await request('/api/public/business/'+business.slug+'/join/request-code',{phone:'+50255889966'})).status,503,'dev delivery must fail closed in production');
 ok(await request('/api/staff/logout',{}),'logout');assert.equal((await request('/api/staff/me')).status,401);
 console.log(JSON.stringify({ok:true,node:process.version,checks:['production config','health/readiness','owner signup','secure Host cookies','customer verification/session','Ed25519 QR','award/replay/conflict','offline grant','development delivery disabled','session revocation']},null,2));
}finally{await closeDatabase();}
