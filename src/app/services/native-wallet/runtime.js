import { withDbClientContext, withTransaction } from '../../database.js';
import { NativeWalletRepo } from '../../repositories/native-wallet-repository.js';
import { CustomerRepo } from '../../repositories/customer-repository.js';
import { createAppleProvider } from './apple.js';
import { createGoogleProvider } from './google.js';
import { loadNativeWalletConfig } from './config.js';
import { createNativeWalletService } from './service.js';
import { logger } from '../../../utils/logger.js';

export const walletSettings = loadNativeWalletConfig();
export const walletGlobalContext = fn => withDbClientContext({platformAdmin:true,tenantId:null},fn);
const providers = {};
for (const name of ['apple','google']) {
  if (walletSettings[name].ready) {
    try { providers[name] = name === 'apple' ? createAppleProvider(walletSettings[name].config) : createGoogleProvider(walletSettings[name].config); }
    catch { walletSettings[name].ready = false; walletSettings[name].errors.push('PROVIDER_INITIALIZATION_FAILED'); }
  }
  if (walletSettings[name].enabled && !walletSettings[name].ready) logger.warn({provider:name,issues:walletSettings[name].errors},'Native Wallet disabled: incomplete configuration');
}
export const nativeWalletService = createNativeWalletService({
  repo:NativeWalletRepo, customerRepo:CustomerRepo, settings:walletSettings, providers, globalContext:walletGlobalContext,
  withPassLock:(id,fn)=>withTransaction(async client=>{
    // Class updates are shared by a business, so serialize Google operations
    // at that level before reading either class or object data.
    const row=await client.query('SELECT business_id, provider FROM native_wallet_passes WHERE id=$1',[id]);
    if(row.rows[0]?.provider==='google') await client.query("SELECT pg_advisory_xact_lock(hashtext('native-wallet-business'),hashtext($1))",[row.rows[0].business_id]);
    // Every provider write takes this lock before reading its authoritative snapshot.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('native-wallet-provider'),hashtext($1))",[id]);
    return fn();
  })
});
let running = false;
export async function processNativeWalletUpdates() {
  if (running) return;
  running = true;
  try {
    const result = await nativeWalletService.processDue();
    if (result.failed) logger.warn(result,'Native Wallet updates scheduled for retry');
  } catch { logger.warn('Native Wallet update loop could not complete'); }
  finally { running = false; }
}
