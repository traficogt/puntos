import {businessRegion,regionalWindow} from './regional-settings.js';
import {secondVisitMessageAllowed} from "./second-visit-eligibility.js";
import {readinessForBusiness,promotionDelay} from './merchant-data-readiness.js';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { recentMarketingContact } from './marketing-frequency-service.js';
import { dbQuery, withTransaction, withDbClientContext } from '../database.js';
import { config } from '../../config/index.js';
import { notFound, conflict, forbidden } from '../../utils/http-error.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { PlanConfigService } from './plan-config-service.js';
import { sendMessage, marketingProviderReady } from './messaging-service.js';
import { issueMarketingUnsubscribeUrl } from './marketing-preference-service.js';

const STATUSES = ['queued','processing','accepted','failed','uncertain','suppressed'];
const MAX_ATTEMPTS=3;
const DELIVERY_NOTE='Aceptado por el proveedor no significa entregado ni leído. No hay confirmaciones de entrega disponibles.';

export function marketingWindow(now,business={}) { return regionalWindow(now,business); }
export function campaignMessageBody(campaign,unsubscribeUrl) {
  const region=businessRegion(campaign);
  const end=new Date(campaign.expires_at).toLocaleString(region.locale,{timeZone:region.timezone,dateStyle:'short',timeStyle:'short'});
  const amount=region.currency==='GTQ'?`Q${Number(campaign.minimum_purchase_q).toFixed(2)}`:`${new Intl.NumberFormat(region.locale,{maximumFractionDigits:region.minorUnits}).format(Number(campaign.minimum_purchase_q))} ${region.currency}`;
  const availability=campaign.points_budget==null?'':' Sujeta a los puntos disponibles de la campaña.';
  return `${campaign.business_name}: gana ${Number(campaign.bonus_points)} puntos adicionales en una compra de ${amount} o más. Puedes usar esta oferta una vez, hasta el ${end} (zona ${region.timezone}). Sujeta a que la campaña siga activa.${availability}\n\nDejar de recibir promociones: ${unsubscribeUrl}`;
}
export function classifyCampaignSend(result) {
  if (result?.provider==='dev'||result?.simulated) return 'suppressed';
  if (result?.ok===true&&result?.accepted===true) return 'accepted';
  if (result?.suppressed) return 'suppressed';
  if (result?.ok===false&&result?.error==='NO_DELIVERY_PROVIDER') return 'failed';
  if (result?.ok===false&&result?.definiteFailure===true) return 'failed';
  return 'uncertain';
}
/** @param {boolean|'share'} [lock] */
async function campaignById(businessId,campaignId,lock=false) {
  const {rows}=await dbQuery(`SELECT g.*,b.name AS business_name,b.plan,b.program_json FROM growth_campaigns g JOIN businesses b ON b.id=g.business_id
    WHERE g.business_id=$1 AND g.id=$2 ${lock==='share'?'FOR SHARE OF g':lock?'FOR UPDATE OF g':''}`,[businessId,campaignId]);
  if (!rows[0]) throw notFound('Campaña no encontrada.');
  return rows[0];
}
function allowedPlan(plan,overrides) {
  return hasPlanFeature(plan,'campaign_rules',overrides)&&hasPlanFeature(plan,'lifecycle_automation',overrides)&&hasPlanFeature(plan,'analytics',overrides);
}
function campaignBudgetAvailable(campaign) {
  return campaign.points_budget==null || Number(campaign.points_committed??0)+Number(campaign.bonus_points)<=campaign.points_budget;
}
function activeCampaign(campaign,now) {
  return campaign.status==='active'&&new Date(campaign.starts_at)<=now&&new Date(campaign.expires_at)>now;
}
export async function getCampaignMessages({businessId,campaignId,now=new Date()}) {
  const campaign=await campaignById(businessId,campaignId);
  const {rows}=await dbQuery(`SELECT status,count(*)::int AS count FROM growth_message_outbox WHERE business_id=$1 AND campaign_id=$2 GROUP BY status`,[businessId,campaignId]);
  const counts=Object.fromEntries(STATUSES.map(status=>[status,0]));
  for(const row of rows) counts[row.status]=row.count;
  const {rows:eligible}=await dbQuery(`SELECT count(*)::int AS count FROM growth_campaign_members m
    JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id AND c.deleted_at IS NULL
    JOIN customer_marketing_preferences p ON p.business_id=m.business_id AND p.customer_id=m.customer_id AND p.marketing_opt_in=true
    WHERE m.business_id=$1 AND m.campaign_id=$2 AND m.allocation='treatment' AND m.claimed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM growth_message_outbox o WHERE o.business_id=m.business_id AND o.campaign_id=m.campaign_id AND o.customer_id=m.customer_id)`,[businessId,campaignId]);
  const available=campaignBudgetAvailable(campaign);
  const eligible_count=available?eligible[0].count:0;
  const provider_ready=marketingProviderReady();
  const entitled=allowedPlan(campaign.plan,await PlanConfigService.getPlanFeatureOverrides());
  const pause=promotionDelay({business:campaign,campaign,now});
  return {ok:true,data_readiness:readinessForBusiness(campaign,now),pause_reason:pause?.reason??null,pause_until:pause?.until??null,preview:{body:!available?'Esta campaña agotó los puntos disponibles para otro bono. No se pueden preparar más invitaciones.':campaign.expires_at?campaignMessageBody(campaign,new URL('/preferencias-de-mensajes/',config.APP_ORIGIN).toString()):'Activa la campaña para fijar su fecha de vencimiento.',delivery_note:DELIVERY_NOTE},eligible_count,counts,total:Object.values(counts).reduce((a,b)=>a+Number(b),0),provider_ready,provider_note:provider_ready?null:"Configura un proveedor de mensajería para teléfonos antes de preparar envíos.",can_queue:!pause&&entitled&&provider_ready&&activeCampaign(campaign,now)&&eligible_count>0};
}
export async function queueCampaignMessages({businessId,campaignId,request_id,now=new Date()}) {
  const overrides=await PlanConfigService.getPlanFeatureOverrides();
  const outcome=await withTransaction(async client=>{
    const campaign=await campaignById(businessId,campaignId,true);
    if(!allowedPlan(campaign.plan,overrides)) throw forbidden('Tu plan no incluye mensajes de campañas.');
    const previous=await client.query(`SELECT request_id FROM growth_message_requests WHERE business_id=$1 AND campaign_id=$2 AND request_id=$3`,[businessId,campaignId,request_id]);
    if(previous.rowCount) return {queued_count:0,replayed:true};
    const pause=promotionDelay({business:campaign,campaign,now});
    if(pause)throw conflict(pause.reason==='business_busy'?'Las invitaciones están pausadas temporalmente por el negocio.':'Completa la sincronización de compras antes de preparar mensajes para esta audiencia.');
    if(!marketingProviderReady()) throw conflict("Configura un proveedor de mensajería para teléfonos antes de preparar envíos.");
    if(!activeCampaign(campaign,now)) throw conflict('La campaña debe estar activa y vigente.');
    if(!campaignBudgetAvailable(campaign)) throw conflict('La campaña agotó los puntos disponibles para otro bono.');
    await client.query(`INSERT INTO growth_message_requests(business_id,campaign_id,request_id) VALUES($1,$2,$3)`,[businessId,campaignId,request_id]);
    const {rows}=await client.query(`SELECT m.customer_id FROM growth_campaign_members m
      JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id AND c.deleted_at IS NULL
      JOIN customer_marketing_preferences p ON p.business_id=m.business_id AND p.customer_id=m.customer_id AND p.marketing_opt_in=true
      WHERE m.business_id=$1 AND m.campaign_id=$2 AND m.allocation='treatment' AND m.claimed_at IS NULL ORDER BY m.customer_id FOR UPDATE OF p`,[businessId,campaignId]);
    let queued_count=0;
    for(const {customer_id} of rows) {
      if(!await secondVisitMessageAllowed(client,{business:campaign,campaign,customerId:customer_id,now}))continue;
      const inserted=await client.query(`INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,next_attempt_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,campaign_id,customer_id) DO NOTHING`,[crypto.randomUUID(),businessId,campaignId,customer_id,now]);
      queued_count+=inserted.rowCount;
    }
    return {queued_count,replayed:false};
  });
  return {...await getCampaignMessages({businessId,campaignId,now}),...outcome};
}

async function claimMessage(businessId,now,overrides) {
  return withTransaction(async client=>{
    await client.query(`UPDATE growth_message_outbox SET status='uncertain',reason='processing_lease_expired',claim_token=NULL,lease_until=NULL,updated_at=$2
      WHERE business_id=$1 AND status='processing' AND lease_until<=$2`,[businessId,now]);
    const candidate=(await client.query(`SELECT id,customer_id FROM growth_message_outbox WHERE business_id=$1 AND status IN ('queued','failed')
      AND attempts<$3 AND next_attempt_at<=$2 ORDER BY next_attempt_at,id LIMIT 1`,[businessId,now,MAX_ATTEMPTS])).rows[0];
    if(!candidate)return null;
    // Preference before outbox matches opt-out and serializes both automation and campaign claims.
    const prefs=await client.query(`SELECT marketing_opt_in FROM customer_marketing_preferences WHERE business_id=$1 AND customer_id=$2 FOR UPDATE SKIP LOCKED`,[businessId,candidate.customer_id]);
    if(!prefs.rows[0])return {skipped:true};
    const row=(await client.query(`SELECT * FROM growth_message_outbox WHERE business_id=$1 AND id=$2 AND status IN ('queued','failed') AND attempts<$4 AND next_attempt_at<=$3 FOR UPDATE SKIP LOCKED`,[businessId,candidate.id,now,MAX_ATTEMPTS])).rows[0];
    if(!row)return {skipped:true};
    const campaign=await campaignById(businessId,row.campaign_id);
    const {rows:customers}=await client.query(`SELECT c.phone,NULL::text AS email,m.allocation,m.claimed_at FROM customers c JOIN growth_campaign_members m
      ON m.business_id=c.business_id AND m.customer_id=c.id AND m.campaign_id=$3 WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`,[businessId,row.customer_id,row.campaign_id]);
    const secondVisitAllowed=await secondVisitMessageAllowed(client,{business:campaign,campaign,customerId:row.customer_id,now});
    const reason=!secondVisitAllowed?'second_visit_unavailable':!prefs.rows[0]?.marketing_opt_in?'consent_revoked':!customers[0]?'customer_removed':customers[0].allocation!=='treatment'?'not_treatment':customers[0].claimed_at?'offer_already_used':!activeCampaign(campaign,now)?'campaign_inactive':!campaignBudgetAvailable(campaign)?'campaign_budget_exhausted':!allowedPlan(campaign.plan,overrides)?'plan_unavailable':null;
    if(reason) {
      await client.query(`UPDATE growth_message_outbox SET status='suppressed',reason=$2,updated_at=$3 WHERE id=$1`,[row.id,reason,now]);
      return {skipped:true};
    }
    const delay=promotionDelay({business:campaign,campaign,now});
    if(delay){await client.query(`UPDATE growth_message_outbox SET next_attempt_at=$2,reason=$3,updated_at=$4 WHERE id=$1`,[row.id,delay.until,delay.reason,now]);return{skipped:true};}
    const cfg=(await client.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0]?.program_json?.lifecycle;
    const contactDays=Number.isInteger(cfg?.minimum_contact_days)?Math.max(7,Math.min(90,cfg.minimum_contact_days)):7;
    const last=await recentMarketingContact(client,{businessId,customerId:row.customer_id,excludeId:row.id,now,days:contactDays});
    const window=marketingWindow(now,campaign);
    if(last||!window.allowed) {
      const nextAt=last?new Date(new Date(last).getTime()+contactDays*86400000):window.nextAt;
      await client.query(`UPDATE growth_message_outbox SET next_attempt_at=$2,reason=$3,updated_at=$4 WHERE id=$1`,[row.id,nextAt,last?'frequency_cap':'quiet_hours',now]);
      return {skipped:true};
    }
    const claim_token=crypto.randomUUID();
    await client.query(`UPDATE growth_message_outbox SET status='processing',claim_token=$2,lease_until=$3,attempts=attempts+1,last_attempt_at=$4,updated_at=$4,reason=NULL WHERE id=$1`,[row.id,claim_token,new Date(now.getTime()+10*60000),now]);
    return {...row,...customers[0],campaign,claim_token,attempts:row.attempts+1};
  });
}

export async function processCampaignMessagesOnce({businessId=null,limit=25,now=()=>new Date(),send=sendMessage}={}) {
  const ids=businessId?[businessId]:await withDbClientContext({platformAdmin:true,tenantId:null},async()=>{
    const {rows}=await dbQuery(`SELECT DISTINCT business_id FROM growth_message_outbox WHERE status IN ('queued','processing') OR (status='failed' AND attempts<3)`);return rows.map(row=>row.business_id);
  });
  const counts={accepted:0,failed:0,uncertain:0,suppressed:0};
  for(const bid of ids) await withDbClientContext({tenantId:bid,platformAdmin:false},async client=>{
    for(let i=0;i<Math.min(limit,200);i++) {
      const overrides=await PlanConfigService.getPlanFeatureOverrides();
      const item=await claimMessage(bid,now(),overrides); if(!item) break; if(item.skipped) continue;
      let result;
      try {
        // Use the already-held request client for the dispatch transaction.
        // sendMessage reads shared plan settings using the transaction pool;
        // wrapping it in withTransaction would hold and then wait on that pool.
        const dispatchOverrides=await PlanConfigService.getPlanFeatureOverrides();
        // Persist the opt-out capability before dispatch: an uncertain provider
        // result or bookkeeping rollback must not invalidate a delivered link.
        const unsubscribeUrl=await issueMarketingUnsubscribeUrl({businessId:bid,customerId:item.customer_id});
        await client.query('BEGIN');
        try {
          // Match purchase/activation lock order and prevent a final bonus from
          // exhausting the campaign between validation and provider dispatch.
          const latestBusiness=(await client.query('SELECT program_json FROM businesses WHERE id=$1 FOR SHARE',[bid])).rows[0];
          const configuredDays=latestBusiness?.program_json?.lifecycle?.minimum_contact_days;
          const latestContactDays=Number.isInteger(configuredDays)?Math.max(7,Math.min(90,configuredDays)):7;
          const current=await campaignById(bid,item.campaign_id,'share');
          const check=await client.query(`SELECT 1 FROM customer_marketing_preferences p JOIN customers c ON c.business_id=p.business_id AND c.id=p.customer_id
            JOIN growth_campaign_members m ON m.business_id=p.business_id AND m.customer_id=p.customer_id AND m.campaign_id=$3
            WHERE p.business_id=$1 AND p.customer_id=$2 AND p.marketing_opt_in=true AND c.deleted_at IS NULL
            AND m.allocation='treatment' AND m.claimed_at IS NULL`,[bid,item.customer_id,item.campaign_id]);
          const dispatchDelay=promotionDelay({business:latestBusiness,campaign:current,now:now()});
          const secondVisitAllowed=await secondVisitMessageAllowed(client,{business:latestBusiness,campaign:current,customerId:item.customer_id,now:now()});
          if(!secondVisitAllowed||!check.rowCount||!activeCampaign(current,now())||!campaignBudgetAvailable(current)||!allowedPlan(current.plan,dispatchOverrides)) result={ok:false,suppressed:true};
          else if(dispatchDelay)result={deferred:dispatchDelay};
          else {
            const last=await recentMarketingContact(client,{businessId:bid,customerId:item.customer_id,excludeId:item.id,now:now(),days:latestContactDays});
            if(last||!marketingWindow(now(),latestBusiness).allowed)result={ok:false,suppressed:true};
            else result=await send({businessId:bid,customerId:item.customer_id,channel:'campaign',to:item.phone||item.email,destinations:{phone:item.phone,email:item.email},body:campaignMessageBody(current,unsubscribeUrl),subject:`${current.business_name}: oferta de puntos`});
          }
          await client.query('COMMIT');
        } catch(error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } catch { result={ok:false,error:'DELIVERY_UNCERTAIN'}; }
      if(result && 'deferred' in result){await dbQuery(`UPDATE growth_message_outbox SET status='queued',reason=$3,next_attempt_at=$4,attempts=GREATEST(attempts-1,0),claim_token=NULL,lease_until=NULL,updated_at=$5 WHERE id=$1 AND claim_token=$2 AND status='processing'`,[item.id,item.claim_token,result.deferred.reason,result.deferred.until,now()]);continue;}
      const status=classifyCampaignSend(result);
      const stamp=now();
      const reason=status==='failed'?'provider_rejected':status==='uncertain'?'delivery_uncertain':status==='suppressed'?'dispatch_suppressed':null;
      // A crash here leaves the durable processing lease; recovery marks it uncertain, never retries it.
      await dbQuery(`UPDATE growth_message_outbox SET status=$3,reason=$4,claim_token=NULL,lease_until=NULL,provider=$5,provider_reference=$6,message_log_id=$7,
        accepted_at=CASE WHEN $3='accepted' THEN $8::timestamptz ELSE NULL END,next_attempt_at=$9,updated_at=$8 WHERE id=$1 AND claim_token=$2 AND status='processing'`,
        [item.id,item.claim_token,status,reason,result?.provider||null,result?.providerId||null,result?.id||null,stamp,new Date(stamp.getTime()+Math.pow(2,item.attempts-1)*5*60000)]);
      counts[status]++;
    }
  }).catch(()=>{
    // A failed tenant cannot strand the remaining businesses. Persisted
    // processing claims retain their lease and recover as uncertain.
    logger.warn({businessId:bid,stage:'campaign_dispatch'},'Marketing business dispatch did not complete');
  });
  return counts;
}
