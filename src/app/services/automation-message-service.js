import {promotionDelay} from './merchant-data-readiness.js';
import crypto from 'node:crypto';
import {logger} from '../../utils/logger.js';
import {dbQuery,withTransaction,withDbClientContext} from '../database.js';
import {hasPlanFeature} from '../../utils/plan.js';
import {PlanConfigService} from './plan-config-service.js';
import {sendMessage} from './messaging-service.js';
import {issueMarketingUnsubscribeUrl} from './marketing-preference-service.js';
import {automationSettings} from './automation-controls-service.js';
import {marketingWindow,classifyCampaignSend} from './campaign-message-service.js';
import {recentMarketingContact} from './marketing-frequency-service.js';
import {deliverLifecycleWalletMessage} from './wallet-notification-service.js';
import {PlatformSettingsRepo} from '../repositories/platform-settings-repository.js';
import {resolveWalletBroadcast,walletBroadcastDelivery} from './wallet-broadcast-config.js';

export function automationMessageBody(item,businessName) {
  const opening=item.rule==='birthday'?'¡Feliz cumpleaños!':'Te extrañamos. Nos encantará verte de nuevo.';
  return `${businessName}: ${opening} ${item.points>0?`Ya abonamos ${item.points} puntos a tu cuenta. `:''}Consulta tus beneficios en PuntosFieles.`;
}
async function claim(businessId,now,overrides,walletEnabled,walletCfg) {
  return withTransaction(async client=>{
    await client.query(`UPDATE lifecycle_message_outbox SET status='uncertain',reason='processing_lease_expired',claim_token=NULL,lease_until=NULL,updated_at=$2 WHERE business_id=$1 AND status='processing' AND lease_until<=$2`,[businessId,now]);
    // Preference before outbox avoids a lock cycle with opt-out. Shared with campaign claims.
    const candidate=(await client.query(`SELECT id,customer_id FROM lifecycle_message_outbox WHERE business_id=$1 AND status IN ('queued','failed') AND attempts<3 AND next_attempt_at<=$2 ORDER BY next_attempt_at,id LIMIT 1`,[businessId,now])).rows[0];if(!candidate)return null;
    const pref=await client.query('SELECT marketing_opt_in FROM customer_marketing_preferences WHERE business_id=$1 AND customer_id=$2 FOR UPDATE SKIP LOCKED',[businessId,candidate.customer_id]);
    if(!pref.rows[0])return {skipped:true};
    const item=(await client.query(`SELECT * FROM lifecycle_message_outbox WHERE business_id=$1 AND id=$2 AND status IN ('queued','failed') AND attempts<3 AND next_attempt_at<=$3 FOR UPDATE SKIP LOCKED`,[businessId,candidate.id,now])).rows[0];if(!item)return {skipped:true};
    const business=(await client.query('SELECT name,plan,program_json FROM businesses WHERE id=$1',[businessId])).rows[0];
    const customer=(await client.query(`SELECT c.phone${walletEnabled?', EXISTS(SELECT 1 FROM native_wallet_passes w WHERE w.business_id=c.business_id AND w.customer_id=c.id AND w.revoked_at IS NULL) AS has_pass':', false AS has_pass'} FROM customers c WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`,[businessId,item.customer_id])).rows[0];
    const cfg=automationSettings(business?.program_json?.lifecycle,business);
    const reach=walletBroadcastDelivery({enabled:true,channelPolicy:walletCfg.channelPolicy,hasPass:customer?.has_pass===true,hasPhone:!!customer?.phone});
    const reason=!pref.rows[0].marketing_opt_in?'consent_revoked':(!reach.tryWallet&&!reach.smsFallback)?'customer_unavailable':new Date(item.expires_at)<=now?'message_expired':!cfg[`${item.rule}_enabled`]?'automation_paused':!business||!hasPlanFeature(business.plan,'lifecycle_automation',overrides)?'plan_unavailable':null;
    if(reason) {await client.query(`UPDATE lifecycle_message_outbox SET status='suppressed',reason=$2,updated_at=$3 WHERE id=$1`,[item.id,reason,now]);return{skipped:true};}
    const delay=promotionDelay({business,rule:item.rule,now});
    if(delay){await client.query(`UPDATE lifecycle_message_outbox SET next_attempt_at=$2,reason=$3,updated_at=$4 WHERE id=$1`,[item.id,delay.until,delay.reason,now]);return{skipped:true};}
    const last=await recentMarketingContact(client,{businessId,customerId:item.customer_id,excludeId:item.id,now,days:cfg.minimum_contact_days});
    const window=marketingWindow(now,business);
    if(last||!window.allowed) {
      const nextAt=last?new Date(new Date(last).getTime()+cfg.minimum_contact_days*86400000):window.nextAt;
      await client.query(`UPDATE lifecycle_message_outbox SET next_attempt_at=$2,reason=$3,updated_at=$4,status=CASE WHEN $2::timestamptz>=expires_at THEN 'suppressed' ELSE status END WHERE id=$1`,[item.id,nextAt,last?'frequency_cap':'quiet_hours',now]);return{skipped:true};
    }
    const claim_token=crypto.randomUUID();
    await client.query(`UPDATE lifecycle_message_outbox SET status='processing',claim_token=$2,lease_until=$3,attempts=attempts+1,last_attempt_at=$4,updated_at=$4,reason=NULL WHERE id=$1`,[item.id,claim_token,new Date(now.getTime()+10*60000),now]);return{...item,claim_token,attempts:item.attempts+1};
  });
}
export async function processAutomationMessagesOnce({businessId=null,limit=25,now=()=>new Date(),send=sendMessage}={}) {
  const ids=businessId?[businessId]:await withDbClientContext({platformAdmin:true,tenantId:null},async()=>{
    const {rows}=await dbQuery(`SELECT DISTINCT business_id FROM lifecycle_message_outbox WHERE status IN ('queued','processing') OR (status='failed' AND attempts<3)`);return rows.map(row=>row.business_id);
  });
  // Deliver via wallet push only where the pass table exists; this stays false for the
  // schema.sql bootstrap (no native_wallet_passes), keeping the SMS/email path unchanged.
  const walletEnabled=await withDbClientContext({platformAdmin:true,tenantId:null},async()=>{
    const {rows}=await dbQuery("SELECT to_regclass('native_wallet_passes') IS NOT NULL AS ok");return rows[0]?.ok===true;
  });
  // Platform-owned per-business channel policy (superadmin-set). The wallet-first default preserves prior behavior.
  const walletSettings=walletEnabled?await PlatformSettingsRepo.getWalletBroadcast():{};
  const counts={accepted:0,failed:0,uncertain:0,suppressed:0};
  for(const bid of ids)await withDbClientContext({tenantId:bid,platformAdmin:false},async client=>{
    const walletCfg=resolveWalletBroadcast(walletSettings,bid);
    for(let i=0;i<Math.min(200,Math.max(1,limit));i++) {
      const overrides=await PlanConfigService.getPlanFeatureOverrides();const item=await claim(bid,now(),overrides,walletEnabled,walletCfg);if(!item)break;if(item.skipped)continue;
      let result;
      try {
        const dispatchOverrides=await PlanConfigService.getPlanFeatureOverrides();
        // Commit capability before provider I/O; an uncertain response cannot invalidate the link.
        const unsubscribeUrl=await issueMarketingUnsubscribeUrl({businessId:bid,customerId:item.customer_id});
        await client.query('BEGIN');
        try {
          const business=(await client.query('SELECT name,plan,program_json FROM businesses WHERE id=$1 FOR SHARE',[bid])).rows[0];
          const customer=(await client.query(`SELECT c.phone${walletEnabled?', EXISTS(SELECT 1 FROM native_wallet_passes w WHERE w.business_id=c.business_id AND w.customer_id=c.id AND w.revoked_at IS NULL) AS has_pass':', false AS has_pass'} FROM customers c WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL FOR SHARE`,[bid,item.customer_id])).rows[0];
          const pref=(await client.query('SELECT marketing_opt_in FROM customer_marketing_preferences WHERE business_id=$1 AND customer_id=$2 FOR SHARE',[bid,item.customer_id])).rows[0];
          const current=(await client.query(`SELECT status,claim_token FROM lifecycle_message_outbox WHERE id=$1`,[item.id])).rows[0];
          const cfg=automationSettings(business?.program_json?.lifecycle,business);
          const dispatchDelay=promotionDelay({business,rule:item.rule,now:now()});
          const reach=walletBroadcastDelivery({enabled:true,channelPolicy:walletCfg.channelPolicy,hasPass:customer?.has_pass===true,hasPhone:!!customer?.phone});
          if(!business||(!reach.tryWallet&&!reach.smsFallback)||!pref?.marketing_opt_in||!cfg[`${item.rule}_enabled`]||!hasPlanFeature(business.plan,'lifecycle_automation',dispatchOverrides)||new Date(item.expires_at)<=now()||current?.status!=='processing'||current?.claim_token!==item.claim_token)result={ok:false,suppressed:true};
          else if(dispatchDelay)result={deferred:dispatchDelay};
          else {
            const last=await recentMarketingContact(client,{businessId:bid,customerId:item.customer_id,excludeId:item.id,now:now(),days:cfg.minimum_contact_days});
            if(last||!marketingWindow(now(),business).allowed)result={ok:false,suppressed:true,suppressionReason:last?'frequency_cap':'quiet_hours'};
            else {
              const body=automationMessageBody(item,business.name);
              // Channel policy (platform-owned, per business) governs wallet vs SMS; the wallet-first
              // default preserves prior behavior. wallet_only never pays for SMS; sms_only never uses wallet.
              const wallet=reach.tryWallet?await deliverLifecycleWalletMessage({businessId:bid,customerId:item.customer_id,body,now}):null;
              if(wallet?.ok)result=wallet;
              else if(reach.smsFallback)result=await send({businessId:bid,customerId:item.customer_id,channel:'lifecycle',to:customer.phone,body,unsubscribeUrl});
              else result={ok:false,suppressed:true,suppressionReason:'customer_unavailable'};
            }
          }
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');throw error;}
      }catch{result={ok:false,error:'DELIVERY_UNCERTAIN'};}
      if(result && 'deferred' in result){await dbQuery(`UPDATE lifecycle_message_outbox SET status='queued',reason=$3,next_attempt_at=$4,attempts=GREATEST(attempts-1,0),claim_token=NULL,lease_until=NULL,updated_at=$5 WHERE id=$1 AND claim_token=$2 AND status='processing'`,[item.id,item.claim_token,result.deferred.reason,result.deferred.until,now()]);continue;}
      const status=classifyCampaignSend(result),stamp=now();
      const reason=status==='failed'?'provider_rejected':status==='uncertain'?'delivery_uncertain':status==='suppressed'?(result && 'suppressionReason' in result?String(result.suppressionReason):'dispatch_suppressed'):null;
      await dbQuery(`UPDATE lifecycle_message_outbox SET status=$3,reason=$4,claim_token=NULL,lease_until=NULL,provider=$5,provider_reference=$6,message_log_id=$7,
        accepted_at=CASE WHEN $3='accepted' THEN $8::timestamptz ELSE NULL END,next_attempt_at=$9,updated_at=$8 WHERE id=$1 AND claim_token=$2 AND status='processing'`,
        [item.id,item.claim_token,status,reason,result?.provider||null,result?.providerId||null,result?.id||null,stamp,new Date(stamp.getTime()+2**(item.attempts-1)*5*60000)]);counts[status]++;
    }
  }).catch(()=>{
    // Leave durable claims intact: lease recovery marks uncertain outcomes
    // without retrying a message whose provider acceptance could be lost.
    logger.warn({businessId:bid,stage:'automation_dispatch'},'Marketing business dispatch did not complete');
  });return counts;
}
