import {occupiedOperatingCapacity} from './operating-capacity-service.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {withTransaction} from '../database.js';
import {badRequest,conflict,notFound} from '../../utils/http-error.js';
import {livePromiseMember,promiseAudit,fingerprint,lockPromiseRequest} from './reward-promise-service.js';
import {lockEntitledBusiness,activateGrowthCampaign,publicGrowthCampaign} from './growth-campaign-service.js';
import {createCampaignPreflight} from './campaign-preflight-service.js';
import {operatingMode} from './merchant-decisions-model.js';
import {businessRegion} from './regional-settings.js';
import {PlanConfigService} from './plan-config-service.js';
const defaults={transaction:withTransaction,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides()};
export const ApproveOperatingTemplateInput=z.object({request_id:z.guid(),campaign_id:z.guid(),maximum_runs:z.number().int().min(1).max(100),capacity:z.number().int().min(1).max(200),expires_at:z.iso.datetime({offset:true})}).strict();
export const TriggerOperatingTemplateInput=z.object({request_id:z.guid(),template_id:z.guid(),version:z.number().int().min(1)}).strict();
export const RevokeOperatingTemplateInput=z.object({template_id:z.guid(),version:z.number().int().min(1)}).strict();
const publicTemplate=row=>({...row,terms:{...row.terms,customer_ids:undefined},audience_count:row.terms.customer_ids.length,remaining_runs:row.maximum_runs-row.used_runs});
export async function listOperatingTemplates(options,injected={}){
 const d={...defaults,...injected};return d.transaction(async client=>{
  const member=await livePromiseMember(client,options,!options.delegated);
  const permissions={operating_mode:member.role==='OWNER',offer_template:member.role==='OWNER'};
  if(options.delegated&&member.role!=='OWNER'){
   const grants=(await client.query("SELECT action FROM staff_service_grants WHERE business_id=$1 AND staff_id=$2 AND branch_id IS NULL AND action IN ('operating_mode','offer_template') AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() AND used_actions<max_actions",[options.businessId,member.id])).rows;
   permissions.operating_mode=grants.some(g=>g.action==='operating_mode');permissions.offer_template=grants.some(g=>g.action==='offer_template');
   if(!permissions.operating_mode&&!permissions.offer_template)return {ok:true,authorized:false,permissions,operating_mode:null,templates:[],drafts:[]};
  }
  const business=(await client.query('SELECT * FROM businesses WHERE id=$1',[options.businessId])).rows[0];
  const templates=(await client.query('SELECT * FROM operating_offer_templates WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[options.businessId])).rows.map(publicTemplate);
  const drafts=options.delegated?[]:(await client.query("SELECT id,name,bonus_points,points_budget,duration_minutes,estimated_cost_per_point_q FROM growth_campaigns WHERE business_id=$1 AND status='draft' AND offer_kind='quiet' ORDER BY created_at DESC LIMIT 100",[options.businessId])).rows;
  return {ok:true,authorized:true,permissions,operating_mode:operatingMode(business),templates:permissions.offer_template?templates:[],drafts};
 });
}
export async function approveOperatingTemplate(options,injected={}){
 const parsed=ApproveOperatingTemplateInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa la oferta, capacidad y vencimiento.');
 const input=parsed.data,d={...defaults,...injected},overrides=await d.getPlanFeatureOverrides(),hash=fingerprint(input);
 return d.transaction(async client=>{
  await livePromiseMember(client,options,true);await lockPromiseRequest(client,options.businessId,input.request_id);await lockEntitledBusiness(client,options.businessId,overrides);
  const prior=(await client.query('SELECT * FROM operating_offer_templates WHERE business_id=$1 AND request_id=$2',[options.businessId,input.request_id])).rows[0];if(prior){if(prior.payload_fingerprint!==hash)throw conflict('La referencia ya tiene otros términos.');return {ok:true,template:publicTemplate(prior),replay:true};}
  const campaign=(await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2 FOR SHARE',[options.businessId,input.campaign_id])).rows[0];if(!campaign)throw notFound('Oferta no encontrada.');
  if(campaign.status!=='draft'||campaign.offer_kind!=='quiet'||campaign.estimated_cost_per_point_q==null||campaign.points_budget==null)throw badRequest('La plantilla necesita una oferta breve en borrador, límite de puntos y costo supuesto conocido.');
  const now=new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at),expires=new Date(input.expires_at);
  if(expires<=now||expires.getTime()-now.getTime()>31*86400000)throw badRequest('La aprobación debe vencer dentro de los próximos 31 días.');
  const members=(await client.query('SELECT m.customer_id FROM growth_campaign_members m JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id WHERE m.business_id=$1 AND m.campaign_id=$2 AND c.deleted_at IS NULL ORDER BY m.customer_id',[options.businessId,campaign.id])).rows.map(x=>x.customer_id);
  if(!members.length||members.length>200||Math.min(members.length,Math.floor(campaign.points_budget/campaign.bonus_points))>input.capacity)throw badRequest('La capacidad debe cubrir el máximo de bonos de la oferta (hasta 200).');
  const region=businessRegion((await client.query('SELECT program_json FROM businesses WHERE id=$1',[options.businessId])).rows[0]);
  const terms={maximum_commitment_points:Math.min(members.length,Math.floor(campaign.points_budget/campaign.bonus_points))*campaign.bonus_points,currency:region.currency,minor_units:region.minorUnits,customer_ids:members,bonus_points:campaign.bonus_points,points_budget:campaign.points_budget,minimum_purchase_q:Number(campaign.minimum_purchase_q),duration_minutes:campaign.duration_minutes,estimated_cost_per_point_q:Number(campaign.estimated_cost_per_point_q),audience_snapshot:campaign.audience_snapshot};
  const row=(await client.query('INSERT INTO operating_offer_templates(id,business_id,source_campaign_id,name,terms,maximum_runs,capacity,expires_at,created_by_staff_id,request_id,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),options.businessId,campaign.id,campaign.name,terms,input.maximum_runs,input.capacity,expires,options.staff.id,input.request_id,hash])).rows[0];
  await promiseAudit(client,options,'operating.template.approved',{template_id:row.id,audience_count:members.length,maximum_runs:input.maximum_runs,points_per_run:terms.points_budget,estimated_cost_per_run:terms.points_budget*terms.estimated_cost_per_point_q,capacity:input.capacity,expires_at:expires});return {ok:true,template:publicTemplate(row),replay:false};
 });
}
export async function revokeOperatingTemplate(options,injected={}){
 const parsed=RevokeOperatingTemplateInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa la plantilla y su versión.');
 return (injected.transaction??withTransaction)(async client=>{await livePromiseMember(client,options,true);const row=(await client.query('UPDATE operating_offer_templates SET revoked_at=clock_timestamp(),version=version+1 WHERE business_id=$1 AND id=$2 AND version=$3 AND revoked_at IS NULL RETURNING id',[options.businessId,parsed.data.template_id,parsed.data.version])).rows[0];if(!row)throw conflict('La aprobación cambió. Actualiza la lista.');await promiseAudit(client,options,'operating.template.revoked',{template_id:row.id});return {ok:true};});
}
export async function triggerOperatingTemplate(options,injected={}){
 const parsed=TriggerOperatingTemplateInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa la plantilla, versión y referencia.');
 const input=parsed.data,d={...defaults,...injected},overrides=await d.getPlanFeatureOverrides(),hash=fingerprint([options.staff.id,input.template_id,input.version]);
 return d.transaction(async client=>{
  const member=await livePromiseMember(client,options);await lockPromiseRequest(client,options.businessId,input.request_id);await lockEntitledBusiness(client,options.businessId,overrides);
  const previous=(await client.query('SELECT * FROM operating_template_runs WHERE business_id=$1 AND request_id=$2',[options.businessId,input.request_id])).rows[0];
  if(previous){if(previous.payload_fingerprint!==hash)throw conflict('La referencia ya activó otra oferta.');const campaign=(await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2',[options.businessId,previous.campaign_id])).rows[0];return {ok:true,campaign:publicGrowthCampaign(campaign),replay:true};}
  const template=(await client.query('SELECT * FROM operating_offer_templates WHERE business_id=$1 AND id=$2 FOR UPDATE',[options.businessId,input.template_id])).rows[0];if(!template)throw notFound('Aprobación no encontrada.');
  const now=new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at);
  if(template.version!==input.version||template.revoked_at||new Date(template.expires_at)<=now||template.used_runs>=template.maximum_runs)throw conflict('La aprobación cambió, venció o agotó sus activaciones.');
  const business=(await client.query('SELECT * FROM businesses WHERE id=$1',[options.businessId])).rows[0];if(operatingMode(business,now).mode==='busy')throw conflict('El negocio está ocupado. Reanuda las invitaciones antes de activar una oferta.');
  const capacity=Math.min(template.capacity,operatingMode(business,now).capacity??template.capacity);
  const t=template.terms;if(t.currency!==businessRegion(business).currency)throw conflict('La moneda cambió. El dueño debe aprobar una nueva plantilla.');
  const concurrent=await occupiedOperatingCapacity(client,options.businessId);
  if(concurrent+t.maximum_commitment_points/t.bonus_points>capacity)throw conflict('Las ofertas activas ya ocupan la capacidad aprobada. Espera a que terminen.');
  if(member.role!=='OWNER'){const {consumeStaffAuthority}=await import('./staff-delegation-service.js');await consumeStaffAuthority(client,{merchantId:options.businessId,staffId:member.id,action:'offer_template',staff:options.staff,locationId:null,points:t.maximum_commitment_points,costAmount:Math.ceil(t.maximum_commitment_points*t.estimated_cost_per_point_q*10**t.minor_units)/10**t.minor_units,referenceType:'operating_template',referenceId:input.request_id});}

  const campaignId=randomUUID();await client.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent,offer_kind,duration_minutes,points_budget,estimated_cost_per_point_q,audience_snapshot,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,NULL,0,'quiet',$7,$8,$9,$10,$11)`,[campaignId,options.businessId,input.request_id,template.name,t.bonus_points,t.minimum_purchase_q,t.duration_minutes,t.points_budget,t.estimated_cost_per_point_q,{...t.audience_snapshot,operating_template_id:template.id},member.id]);
  await client.query('INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id) SELECT gen_random_uuid(),$1,$2,c.id FROM customers c WHERE c.business_id=$1 AND c.id=ANY($3::uuid[]) AND c.deleted_at IS NULL ORDER BY c.id',[options.businessId,campaignId,t.customer_ids]);
  const nested={transaction:fn=>fn(client),getPlanFeatureOverrides:async()=>overrides,audit:async event=>client.query('INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,$3,$4,$5,$6)',[event.id,event.business_id,event.actor_type,event.actor_id,event.action,event.meta])};
  const preview=await createCampaignPreflight({businessId:options.businessId,campaignId},nested);
  const activated=await activateGrowthCampaign({businessId:options.businessId,staffId:member.id,campaignId,preflightId:preview.preflight.id},nested);
  await client.query('UPDATE operating_offer_templates SET used_runs=used_runs+1,version=version+1 WHERE business_id=$1 AND id=$2',[options.businessId,template.id]);
  await client.query('INSERT INTO operating_template_runs(id,business_id,template_id,campaign_id,request_id,staff_id,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),options.businessId,template.id,campaignId,input.request_id,member.id,hash]);
  const mode={mode:'quiet',until:activated.campaign.expires_at,capacity};
  await client.query("UPDATE businesses SET program_json=program_json||jsonb_build_object('merchant_operating_mode',$2::jsonb) WHERE id=$1",[options.businessId,mode]);
  await promiseAudit(client,options,'operating.template.triggered',{template_id:template.id,campaign_id:campaignId,request_id:input.request_id,points_budget:t.points_budget,mode});
  return {ok:true,...activated,operating_mode:operatingMode({program_json:{merchant_operating_mode:mode}},now),replay:false};
 });
}
