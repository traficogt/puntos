import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { requestJoinCodeWithDeps, verifyJoinCodeWithDeps } from "../../src/app/services/customer-service.js";
import { VerifyCodeRepo } from "../../src/app/repositories/verify-code-repository.js";
import { runWithDbContext } from "../../src/app/database.js";

const business = { id: "business-a", slug: "cafe", name: "Cafe" };
const customer = { id: "customer-a", business_id: business.id, phone: "50212345678", name: null };
const hash = await bcrypt.hash("123456", 4);

function fixture() {
  const state = { messages: [], names: [], codes: [], locks: [], failures: 0, consumed: false, signed: 0, inTransaction: false };
  let queue = Promise.resolve();
  const deps = {
    withDbClientContext: async (_context, fn) => fn(),
    withTransaction: async fn => {
      const previous = queue;
      let release = () => {};
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      state.inTransaction = true;
      try { return await fn({ query: async (sql, params) => { state.locks.push({ sql, params }); return { rows: [] }; } }); }
      finally { state.inTransaction = false; release(); }
    },
    CustomerRepo: {
      getByBusinessAndPhone: async () => ({ ...customer }),
      updateName: async (_id, name) => { state.names.push(name); }
    },
    VerifyCodeRepo: {
      countRecent: async () => 0,
      create: async input => { assert.equal(state.inTransaction, true); state.codes.push(input); },
      invalidateById: async () => { state.consumed = true; },
      latestValid: async () => state.consumed || state.failures >= 5 ? null : { id: "code-a", code_hash: hash },
      consume: async () => { assert.equal(state.inTransaction, true); state.consumed = true; return { id: "code-a" }; },
      markFailedAttempt: async () => { assert.equal(state.inTransaction, true); state.failures += 1; }
    },
    sendMessage: async message => { assert.equal(state.inTransaction, false); state.messages.push(message); return { ok: true }; },
    signCustomerToken: async () => { state.signed += 1; return "sandbox-session"; }
  };
  return { deps, state };
}

test("phone login codes never go to an email supplied by an unauthenticated caller", async () => {
  const { deps, state } = fixture();
  await requestJoinCodeWithDeps(deps, { business, phone: customer.phone, email: "attacker@example.test", name: "Injected name", requireExisting: true });
  assert.deepEqual(state.messages[0].destinations, { phone: customer.phone });
  assert.deepEqual(state.names, [], "requesting a code must not mutate an unverified account");
  assert.match(state.locks[0].sql, /pg_advisory_xact_lock/);
});

test("new-phone enrollment also requires control of the phone, never a submitted email", async () => {
  const { deps, state } = fixture();
  deps.CustomerRepo.getByBusinessAndPhone = async () => null;
  await requestJoinCodeWithDeps(deps, { business, phone: customer.phone, email: "attacker@example.test", name: null });
  assert.deepEqual(state.messages[0].destinations, { phone: customer.phone });
});

test("two simultaneous verifications can consume one code and mint one session only", async () => {
  const { deps, state } = fixture();
  const args = { business, phone: customer.phone, code: "123456", name: null, referralCode: null };
  const results = await Promise.allSettled([verifyJoinCodeWithDeps(deps, args), verifyJoinCodeWithDeps(deps, args)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(state.signed, 1);
  assert.ok(state.locks.every(lock => /pg_advisory_xact_lock/.test(lock.sql)));
});

test("failed attempts commit before rejection and block further attempts after five failures", async () => {
  const { deps, state } = fixture();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(verifyJoinCodeWithDeps(deps, { business, phone: customer.phone, code: "000000", name: null, referralCode: null }), /Código inválido/);
    assert.equal(state.inTransaction, false);
  }
  assert.equal(state.failures, 5);
  await assert.rejects(verifyJoinCodeWithDeps(deps, { business, phone: customer.phone, code: "123456", name: null, referralCode: null }), /código válido/);
  assert.equal(state.signed, 0);
});

test("failed delivery invalidates the code while preserving its rate-limit record", async () => {
  const { deps, state } = fixture();
  deps.sendMessage = async () => ({ ok: false });
  await assert.rejects(requestJoinCodeWithDeps(deps, { business, phone: customer.phone, name: null }), /enviar el código/);
  assert.equal(state.consumed, true);
  assert.equal(state.codes.length, 1);
});

test("reissuing and consuming codes retain request history and expire prior credentials", async () => {
  const statements = [];
  await runWithDbContext({ client: { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [{ id: "code-a" }] }; } } }, async () => {
    await VerifyCodeRepo.create({ id: "code-b", business_id: business.id, phone: customer.phone, code_hash: hash, expires_at: new Date() });
    await VerifyCodeRepo.consume("code-b");
  });
  assert.ok(statements.every(({ sql }) => !/DELETE FROM verify_codes/.test(sql)));
  assert.match(statements[0].sql, /UPDATE verify_codes[\s\S]*expires_at/);
  assert.match(statements.at(-1).sql, /UPDATE verify_codes[\s\S]*RETURNING id/);
});

test('acquisition runs only after verified code consumption inside enrollment transaction',async t=>{
  const {TierService}=await import('../../src/app/services/tier-service.js');
  const {GamificationService}=await import('../../src/app/services/gamification-service.js');
  t.mock.method(TierService,'getCustomerTierInfo',async()=>null);
  t.mock.method(GamificationService,'checkAndAwardAchievements',async()=>null);
  for(const isNewCustomer of [true,false]){
    const {deps,state}=fixture();const attributions=[];
    deps.CustomerRepo.getByBusinessAndPhone=async()=>isNewCustomer?null:{...customer};
    let createdId=customer.id;
    deps.CustomerRepo.create=async input=>{createdId=input.id;return {...customer,id:input.id};};
    deps.recordAcquisition=async(client,input)=>{assert.equal(state.inTransaction,true);assert.equal(state.consumed,true);assert.equal(typeof client.query,'function');attributions.push(input);};
    await verifyJoinCodeWithDeps(deps,{business,phone:customer.phone,code:'123456',name:null,referralCode:null,visitToken:'A'.repeat(43)});
    assert.deepEqual(attributions,[{businessId:business.id,customerId:createdId,visitToken:'A'.repeat(43),isNewCustomer}]);
  }
  const {deps,state}=fixture();deps.recordAcquisition=async()=>assert.fail('invalid code cannot attribute');
  await assert.rejects(verifyJoinCodeWithDeps(deps,{business,phone:customer.phone,code:'999999',name:null,referralCode:null,visitToken:'A'.repeat(43)}));
  assert.equal(state.signed,0);
});

test('acquisition storage failures roll back only attribution and keep normal verification',async()=>{
  const {deps,state}=fixture();
  deps.recordAcquisition=async()=>{throw new Error('unavailable');};
  const result=await verifyJoinCodeWithDeps(deps,{business,phone:customer.phone,code:'123456',name:null,referralCode:null,visitToken:'A'.repeat(43)});
  assert.equal(result.customer.id,customer.id);
  assert.ok(state.locks.some(({sql})=>sql==='ROLLBACK TO SAVEPOINT acquisition_signup'));
});

test('a concurrent customer upsert does not turn an existing card into a new acquisition',async t=>{
  const {TierService}=await import('../../src/app/services/tier-service.js');
  const {GamificationService}=await import('../../src/app/services/gamification-service.js');
  t.mock.method(TierService,'getCustomerTierInfo',async()=>null);t.mock.method(GamificationService,'checkAndAwardAchievements',async()=>null);
  const {deps}=fixture();let actual={isNewCustomer:true};
  deps.CustomerRepo.getByBusinessAndPhone=async()=>null;
  deps.CustomerRepo.create=async()=>({...customer});
  deps.recordAcquisition=async(_client,input)=>{actual=input;};
  await verifyJoinCodeWithDeps(deps,{business,phone:customer.phone,code:'123456',name:null,referralCode:null,visitToken:'A'.repeat(43)});
  assert.equal(actual.isNewCustomer,false);
});
