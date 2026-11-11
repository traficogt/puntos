import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, notFound, unauthorized } from '../../../utils/http-error.js';

const unavailable = () => new HttpError(503, 'La tarjeta no está disponible en este momento. Intenta de nuevo más tarde.');
const secretEquals = (a,b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

export function createNativeWalletService({repo, customerRepo, settings, providers, globalContext, withPassLock = async (_id, fn) => fn()}) {
  const readyProviders = () => ['apple','google'].filter(name=>settings[name]?.ready && providers[name]);
  const requireProvider = name => {
    if (!readyProviders().includes(name)) throw unavailable();
    return providers[name];
  };
  async function requireCustomer(auth) {
    const c = await customerRepo.getById(auth.id);
    if (!c || c.business_id !== auth.business_id) throw notFound('Customer not found');
  }
  async function status(auth) {
    const names = readyProviders();
    await requireCustomer(auth);
    let passes;
    try { passes = await repo.getCustomerPasses(auth.business_id,auth.id); }
    catch(e) {
      // Disabled deployments may precede the additive migration; existing passes
      // stay visible for revocation whenever storage is available.
      if (!names.length && e?.code === '42P01') passes=[]; else throw e;
    }
    return {providers:{apple:names.includes('apple'),google:names.includes('google')},passes:passes.filter(p=>!p.revoked_at).map(p=>({provider:p.provider,created_at:p.created_at}))};
  }
  async function issue(auth, providerName) {
    const provider = requireProvider(providerName);
    await requireCustomer(auth);
    const pass = await repo.ensurePass({id:randomUUID(),businessId:auth.business_id,customerId:auth.id,provider:providerName,membershipToken:randomBytes(32).toString('base64url'),authenticationToken:randomBytes(32).toString('base64url')});
    if (!pass) throw notFound("Customer not found");
    return withPassLock(pass.id, async()=>{
      const snapshot = await repo.getSnapshot(pass.id);
      if (!snapshot || snapshot.revoked_at || snapshot.is_voided) throw notFound('La tarjeta fue desactivada. Intenta de nuevo.');
      try {
        if (providerName === 'apple') {
          await provider.generatePass(snapshot);
          return {url:'/api/customer/wallet/apple/download'};
        }
        return {url:await provider.savePass(snapshot)};
      } catch { throw unavailable(); }
    });
  }
  async function downloadApple(auth) {
    const provider = requireProvider('apple');
    await requireCustomer(auth);
    const passes = await repo.getCustomerPasses(auth.business_id,auth.id);
    const pass = passes.find(p=>p.provider==='apple' && !p.revoked_at);
    if (!pass) throw notFound('Primero solicita tu tarjeta Apple Wallet.');
    const snapshot = await repo.getSnapshot(pass.id);
    if (!snapshot || snapshot.revoked_at || snapshot.is_voided) throw notFound('La tarjeta fue desactivada.');
    try { return await provider.generatePass(snapshot); } catch { throw unavailable(); }
  }
  async function revoke(auth) {
    await requireCustomer(auth);
    await repo.revokeCustomerPasses(auth.business_id,auth.id);
    return {ok:true};
  }
  async function authenticateApple(passType, serial, authorization) {
    requireProvider('apple');
    if (passType !== settings.apple.config.passTypeIdentifier || !/^ApplePass [A-Za-z0-9_-]{43}$/.test(authorization || '')) throw unauthorized();
    const pass = await globalContext(()=>repo.getBySerial(serial,'apple'));
    if (!pass || pass.provider !== 'apple' || pass.serial_number !== serial || !secretEquals(authorization.slice(10),pass.authentication_token)) throw unauthorized();
    return pass;
  }
  async function updatedApplePass(pass) {
    const snapshot = await globalContext(()=>repo.getSnapshot(pass.id));
    if (!snapshot) throw notFound();
    try { return {bytes:await requireProvider('apple').generatePass(snapshot),revision:snapshot.revision,updatedAt:snapshot.updated_at || snapshot.created_at}; } catch { throw unavailable(); }
  }
  async function processDue() {
    const names = readyProviders();
    const result = {delivered:0,failed:0};
    if (!names.length) return result;
    const jobs = await globalContext(()=>repo.claimDue(20,names));
    for (const job of jobs) {
      try {
        await globalContext(()=>withPassLock(job.id,async()=>{
          const snapshot = await repo.getSnapshot(job.id);
          if (!snapshot) throw Error('Missing pass');
          const provider = requireProvider(job.provider);
          if (job.provider === 'google') await provider.updatePass(snapshot);
          else {
            const registrations = await repo.listRegistrations(job.id);
            for (const registration of registrations) {
              const response = await provider.pushUpdate(registration.push_token);
              if (response.invalidToken) await repo.deletePushToken(registration.push_token);
            }
          }
          await repo.markSynced(job.id,snapshot.revision,job.lock_token,snapshot.next_refresh_at??null);
        }));
        result.delivered++;
      } catch {
        await globalContext(()=>repo.markFailed(job.id,job.lock_token));
        result.failed++;
      }
    }
    return result;
  }
  return {status,issue,downloadApple,revoke,authenticateApple,updatedApplePass,processDue,requireProvider};
}
