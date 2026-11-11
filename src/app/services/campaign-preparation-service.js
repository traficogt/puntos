import { createHash, randomUUID } from 'node:crypto';
import { withTransaction, withDbClientContext } from '../database.js';
import { AuditRepo } from '../repositories/audit-repository.js';
import { PlanConfigService } from './plan-config-service.js';
import { parseAudienceDefinition } from './customer-audience-definition.js';
import { snapshotFrozenCustomerAudience } from './customer-audience-service.js';
import { publicGrowthCampaign, lockEntitledBusiness, auditChange, validateCampaignTerms } from './growth-campaign-service.js';
import { badRequest, conflict, notFound } from '../../utils/http-error.js';

const JOB_TYPE = 'growth.campaign.prepare';
const transactionDefaults = { transaction: withTransaction, audit: AuditRepo.log, getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides() };
async function enqueue(client, businessId, campaignId) {
  const jobId = randomUUID();
  await client.query('INSERT INTO background_jobs(id,business_id,job_type,payload) VALUES($1,$2,$3,$4)',[jobId,businessId,JOB_TYPE,{businessId,campaignId}]);
  return jobId;
}
export async function createCampaignPreparation(options, dependencies = {}) {
  const { transaction, audit, getPlanFeatureOverrides } = { ...transactionDefaults, ...dependencies };
  const { businessId, staffId, requestId, audienceSegmentId, audienceSegmentVersion, audienceLimit, name, bonusPoints, minimumPurchaseQ = 0, durationDays,
    holdoutPercent = 20, pointsBudget = null, estimatedCostPerPointQ = null } = options;
  validateCampaignTerms({ name,bonusPoints,minimumPurchaseQ,durationDays,holdoutPercent,pointsBudget,estimatedCostPerPointQ });
  if (options.recoveryRunId || options.offerKind && options.offerKind !== 'experiment' || !audienceSegmentId || !Number.isInteger(audienceSegmentVersion) || audienceSegmentVersion < 1 || !Number.isInteger(audienceLimit) || audienceLimit < 10 || audienceLimit > 5000) throw badRequest('Selecciona una audiencia guardada, su versión y un máximo de 5,000 clientes.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ audienceSegmentId,audienceSegmentVersion,audienceLimit,name:name.trim(),bonusPoints,minimumPurchaseQ,durationDays,holdoutPercent,pointsBudget,estimatedCostPerPointQ })).digest('hex');
  const overrides = await getPlanFeatureOverrides();
  return transaction(async client => {
    await lockEntitledBusiness(client,businessId,overrides);
    const previous = (await client.query('SELECT g.*,p.request_fingerprint FROM growth_campaigns g LEFT JOIN growth_campaign_preparations p ON p.business_id=g.business_id AND p.campaign_id=g.id WHERE g.business_id=$1 AND g.request_id=$2',[businessId,requestId])).rows[0];
    if (previous) {
      if (previous.request_fingerprint !== fingerprint) throw conflict('Esta solicitud ya se usó con otros datos.');
      return { campaign: publicGrowthCampaign(previous) };
    }
    const segment = (await client.query('SELECT * FROM merchant_audiences WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,audienceSegmentId])).rows[0];
    if (!segment) throw notFound('No se encontró esta audiencia.');
    if (segment.archived || segment.version !== audienceSegmentVersion) throw conflict('La audiencia cambió o está archivada. Revisa su versión.');
    const campaignId = randomUUID();
    const snapshot = { segment_id: segment.id, segment_version: segment.version, name: segment.name, definition: parseAudienceDefinition(segment.definition), limit: audienceLimit, preparation:'background', generated_at:null, cutoff:null };
    const campaign = (await client.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent,points_budget,estimated_cost_per_point_q,audience_snapshot,created_by_staff_id,preparation_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued') RETURNING *`,[campaignId,businessId,requestId,name.trim(),bonusPoints,minimumPurchaseQ,durationDays,holdoutPercent,pointsBudget,estimatedCostPerPointQ,snapshot,staffId])).rows[0];
    const jobId = await enqueue(client,businessId,campaignId);
    await client.query('INSERT INTO growth_campaign_preparations(business_id,campaign_id,request_fingerprint,job_id) VALUES($1,$2,$3,$4)',[businessId,campaignId,fingerprint,jobId]);
    await auditChange(audit,'growth.campaign.preparation.queued',options,campaign);
    return { campaign: publicGrowthCampaign(campaign) };
  });
}
/** Crash-safe payload contract for background_jobs. Each chunk commits its own
 * progress. Concurrent/restarted handlers serialize on the campaign row and
 * never re-evaluate a captured audience. No customer notification is performed. */
export async function runCampaignPreparationJob({ businessId,campaignId }, { transaction = withTransaction,
  runInTenant = (id, fn) => withDbClientContext({tenantId:id,platformAdmin:false},fn), afterChunk = async (_progress) => {} } = {}) {
  if (!businessId || !campaignId) throw badRequest('Falta la campaña que se debe preparar.');
  return runInTenant(businessId,async () => {
    try {
      for (;;) {
        const progress = await transaction(async client => {
          const campaign = (await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,campaignId])).rows[0];
          if (!campaign) return {ok:true,campaignId,status:'removed',prepared:0,total:0};
          const preparation = (await client.query('SELECT * FROM growth_campaign_preparations WHERE business_id=$1 AND campaign_id=$2 FOR UPDATE',[businessId,campaignId])).rows[0];
          if (!preparation) throw notFound('No se encontró esta preparación.');
          if (['ready','cancelled'].includes(campaign.preparation_status)) return {ok:true,campaignId,status:campaign.preparation_status,prepared:campaign.prepared_count,total:preparation.customer_ids?.length??0};
          let ids = preparation.customer_ids;
          if (ids === null) {
            const now = new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at);
            const captured = await snapshotFrozenCustomerAudience({businessId,snapshot:campaign.audience_snapshot,limit:campaign.audience_snapshot.limit,now},client);
            ids = captured.customerIds;
            await client.query('UPDATE growth_campaign_preparations SET customer_ids=$3,snapshot_at=$4,last_error=NULL,updated_at=clock_timestamp() WHERE business_id=$1 AND campaign_id=$2',[businessId,campaignId,ids,now]);
            await client.query('UPDATE growth_campaigns SET audience_snapshot=$3,preparation_status=\'preparing\' WHERE business_id=$1 AND id=$2',[businessId,campaignId,captured.snapshot]);
          }
          const chunk = ids.slice(campaign.prepared_count,campaign.prepared_count+250);
          // Lock existing customers through insertion; erased IDs remain only in
          // the preparation snapshot, never reappear as new members on replay.
          const active = (await client.query('SELECT id FROM customers WHERE business_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR KEY SHARE',[businessId,chunk])).rows;
          if (active.length) await client.query(`INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id)
            SELECT member_id,$1,$2,customer_id FROM unnest($3::uuid[],$4::uuid[]) AS selected(member_id,customer_id)
            ON CONFLICT(business_id,campaign_id,customer_id) DO NOTHING`,[businessId,campaignId,active.map(()=>randomUUID()),active.map(c=>c.id)]);
          const prepared = campaign.prepared_count+chunk.length;
          // Publish readiness on the next transaction so cancellation can win
          // after any committed chunk, including the final one.
          const status = chunk.length ? 'preparing' : 'ready';
          await client.query(`UPDATE growth_campaigns SET prepared_count=$3,preparation_status=$4,
            member_count=(SELECT count(*) FROM growth_campaign_members WHERE business_id=$1 AND campaign_id=$2) WHERE business_id=$1 AND id=$2`,[businessId,campaignId,prepared,status]);
          return {ok:true,campaignId,status,prepared,total:ids.length};
        });
        if (['ready','cancelled','removed'].includes(progress.status)) return progress;
        await afterChunk(progress);
      }
    } catch (error) {
      await transaction(async client => {
        // Lock order matches the worker and owner controls.
        await client.query("UPDATE growth_campaigns SET preparation_status='failed' WHERE business_id=$1 AND id=$2 AND preparation_status IN ('queued','preparing','failed')",[businessId,campaignId]);
        await client.query("UPDATE growth_campaign_preparations SET last_error='preparation_failed',updated_at=clock_timestamp() WHERE business_id=$1 AND campaign_id=$2",[businessId,campaignId]);
      });
      throw error;
    }
  });
}
async function changePreparation(options, action, dependencies) {
  const {transaction,audit,getPlanFeatureOverrides}={...transactionDefaults,...dependencies};
  const overrides=await getPlanFeatureOverrides(), {businessId,campaignId}=options;
  return transaction(async client=>{
    await lockEntitledBusiness(client,businessId,overrides);
    const campaign=(await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,campaignId])).rows[0];
    if(!campaign) throw notFound('No se encontró esta campaña.');
    const preparation=(await client.query('SELECT * FROM growth_campaign_preparations WHERE business_id=$1 AND campaign_id=$2 FOR UPDATE',[businessId,campaignId])).rows[0];
    if(!preparation)throw conflict('Esta campaña no tiene una preparación en segundo plano.');
    if(action==='cancel'&&campaign.preparation_status==='cancelled')return{campaign:publicGrowthCampaign(campaign)};
    if(campaign.status!=='draft'||['cancelled','ready'].includes(campaign.preparation_status))throw conflict('Esta preparación ya terminó.');
    if(action==='retry'){
      if(campaign.preparation_status!=='failed')throw conflict('La preparación sigue en curso. Actualiza su estado.');
      const job=(await client.query('SELECT status FROM background_jobs WHERE id=$1',[preparation.job_id])).rows[0];
      // A failed chunk may already have an automatic worker retry scheduled.
      // Let the owner expedite that existing queued attempt; don't duplicate it.
      if(job?.status==='RUNNING')throw conflict('El trabajador aún está procesando el intento. Actualiza el estado antes de reintentar.');
      if(job?.status==='QUEUED')await client.query('UPDATE background_jobs SET run_after=clock_timestamp() WHERE id=$1',[preparation.job_id]);
      else {
        const jobId=await enqueue(client,businessId,campaignId);
        await client.query('UPDATE growth_campaign_preparations SET job_id=$3,last_error=NULL,updated_at=clock_timestamp() WHERE business_id=$1 AND campaign_id=$2',[businessId,campaignId,jobId]);
      }
    }
    const updated=(await client.query('UPDATE growth_campaigns SET preparation_status=$3 WHERE business_id=$1 AND id=$2 RETURNING *',[businessId,campaignId,action==='retry'?'queued':'cancelled'])).rows[0];
    await auditChange(audit,`growth.campaign.preparation.${action==='retry'?'retried':'cancelled'}`,options,updated);
    return{campaign:publicGrowthCampaign(updated)};
  });
}
export const cancelCampaignPreparation=(options,deps={})=>changePreparation(options,'cancel',deps);
export const retryCampaignPreparation=(options,deps={})=>changePreparation(options,'retry',deps);
