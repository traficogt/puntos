import {z} from 'zod';
import {currentPilotChecklistVersion,pilotChecksForVersion} from '../../../public/pilot-checklists.js';
import { randomUUID } from 'node:crypto';
import { dbQuery, withTransaction } from '../database.js';
import { AuditRepo } from '../repositories/audit-repository.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/http-error.js';
import { reportingPurchase } from './reporting-purchase.js';
export const PILOT_CHECKS = pilotChecksForVersion(currentPilotChecklistVersion);
const profileText=z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const PilotPosProfile=z.object({vendor:profileText,pos_version:profileText,module_version:profileText.nullable().default(null),deployment:z.enum(['unknown','online','odoo_sh','self_hosted','cloud','other'])}).strict();
function normalizedProfile(value){const parsed=PilotPosProfile.nullable().safeParse(value??null);if(!parsed.success)throw badRequest('Revisa el sistema, sus versiones y el alojamiento del piloto.');return parsed.data;}
const profileSignature=value=>JSON.stringify(normalizedProfile(value));
const defaults={query:dbQuery,transaction:withTransaction,audit:AuditRepo.log,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),now:()=>new Date()};
const iso=v=>v?new Date(v).toISOString():null;
function publicPilot(p){return {id:p.id,checklist_version:p.checklist_version,pos_profile:p.pos_profile,name:p.name,duration_days:p.duration_days,status:p.status,started_at:iso(p.started_at),planned_end_at:iso(p.planned_end_at),closed_at:iso(p.closed_at),close_note:p.close_note};}
async function entitled(client,businessId,overrides){
 const {rows}=await client.query('SELECT id,plan FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
 if(!rows[0])throw notFound('Negocio no encontrado.');
 if(!hasPlanFeature(rows[0].plan,'analytics',overrides))throw forbidden('Tu plan no incluye seguimiento de pilotos.');
}
async function auditChange(deps,actor,pilot,action){await deps.audit({id:randomUUID(),business_id:actor.businessId,actor_type:'STAFF',actor_id:actor.staffId,action,ip:actor.ip??null,ua:actor.ua??null,meta:{pilot_id:pilot.id,status:pilot.status}});}
async function lockedPilot(client,businessId,pilotId){const {rows}=await client.query('SELECT * FROM merchant_pilots WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,pilotId]);if(!rows[0])throw notFound('Piloto no encontrado.');return rows[0];}
export async function createPilot(options,injected={}){
 const d={...defaults,...injected},overrides=await d.getPlanFeatureOverrides();
 const {businessId,staffId,requestId,durationDays}=options,name=options.name.trim(),posProfile=normalizedProfile(options.posProfile);
 return d.transaction(async client=>{
  await entitled(client,businessId,overrides);
  const old=await client.query('SELECT * FROM merchant_pilots WHERE business_id=$1 AND request_id=$2',[businessId,requestId]);
  if(old.rows[0]){if(old.rows[0].name!==name||old.rows[0].duration_days!==durationDays||profileSignature(old.rows[0].pos_profile)!==profileSignature(posProfile))throw conflict('Esta solicitud ya se usó con otros datos.');return {pilot:publicPilot(old.rows[0])};}
  const active=await client.query("SELECT id FROM merchant_pilots WHERE business_id=$1 AND status='active'",[businessId]);if(active.rows.length)throw conflict('Ya tienes un piloto activo. Ciérralo antes de iniciar otro.');
  const id=randomUUID(),start=d.now();
  const {rows}=await client.query("INSERT INTO merchant_pilots(id,business_id,request_id,name,duration_days,started_at,planned_end_at,created_by_staff_id,checklist_version,pos_profile) VALUES($1,$2,$3,$4,$5,$6,$6::timestamptz+make_interval(days=>$5::int),$7,$8,$9) RETURNING *",[id,businessId,requestId,name,durationDays,start,staffId,currentPilotChecklistVersion,posProfile]);
  for(const check of PILOT_CHECKS)await client.query('INSERT INTO merchant_pilot_checks(business_id,pilot_id,check_key) VALUES($1,$2,$3)',[businessId,id,check.key]);
  await auditChange(d,options,rows[0],'merchant.pilot.created');return {pilot:publicPilot(rows[0])};
 });
}
export async function listPilots({businessId,offset=0},injected={}){
 const d={...defaults,...injected};const {rows}=await d.query(`WITH all_rows AS(SELECT * FROM merchant_pilots WHERE business_id=$1), page AS(SELECT * FROM all_rows ORDER BY started_at DESC,id DESC LIMIT 20 OFFSET $2) SELECT (SELECT count(*)::int FROM all_rows) AS total,COALESCE((SELECT jsonb_agg(p ORDER BY started_at DESC,id DESC) FROM page p),'[]'::jsonb) AS pilots,(SELECT to_jsonb(completed) FROM (SELECT * FROM all_rows WHERE status='completed' ORDER BY closed_at DESC,id DESC LIMIT 1) completed) AS latest_completed`,[businessId,offset]);
 return {pilots:rows[0].pilots.map(publicPilot),latest_completed:rows[0].latest_completed?publicPilot(rows[0].latest_completed):null,total:rows[0].total,limit:20,offset};
}
export async function updatePilotCheck(options,injected={}){
 const d={...defaults,...injected},overrides=await d.getPlanFeatureOverrides();
 const note=options.note.trim();
 if(options.status!=='pending'&&!note)throw badRequest('Registra qué comprobaste sin incluir datos personales.');
 return d.transaction(async client=>{
  await entitled(client,options.businessId,overrides);const p=await lockedPilot(client,options.businessId,options.pilotId);
  if(p.status!=='active')throw conflict('El piloto está cerrado. Conservamos sus registros.');
  const definition=pilotChecksForVersion(p.checklist_version).find(c=>c.key===options.key);
  if(!definition)throw badRequest('Esta prueba no pertenece a la versión del piloto.');
  if(options.status==='not_applicable'&&definition.required)throw badRequest('Esta prueba es obligatoria.');
  const updated=await client.query('UPDATE merchant_pilot_checks SET status=$4,note=$5,updated_at=$6,updated_by_staff_id=$7 WHERE business_id=$1 AND pilot_id=$2 AND check_key=$3',[options.businessId,options.pilotId,options.key,options.status,note,d.now(),options.staffId]);
  if(updated.rowCount!==1)throw conflict('No se encontró el registro de esta prueba. Actualiza el piloto antes de guardar.');
  await auditChange(d,options,p,'merchant.pilot.check.updated');return {ok:true};
 });
}
export async function closePilot(options,injected={}){
 const d={...defaults,...injected},overrides=await d.getPlanFeatureOverrides();
 return d.transaction(async client=>{
  await entitled(client,options.businessId,overrides);const p=await lockedPilot(client,options.businessId,options.pilotId);
  if(p.status!=='active'){if(p.status!==options.outcome||p.close_note!==options.note.trim())throw conflict('El piloto está cerrado.');return {pilot:publicPilot(p)};}
  if(options.outcome==='completed'){
   const {rows}=await client.query('SELECT check_key,status FROM merchant_pilot_checks WHERE business_id=$1 AND pilot_id=$2',[options.businessId,options.pilotId]);
   if(pilotChecksForVersion(p.checklist_version).some(c=>!rows.some(r=>r.check_key===c.key&&(r.status==='passed'||(!c.required&&r.status==='not_applicable')))))throw conflict('Completa las pruebas obligatorias y revisa las opcionales antes de finalizar.');
  }
  const {rows}=await client.query('UPDATE merchant_pilots SET status=$3,closed_at=$4,close_note=$5 WHERE business_id=$1 AND id=$2 RETURNING *',[options.businessId,options.pilotId,options.outcome,d.now(),options.note.trim()]);
  await auditChange(d,options,rows[0],'merchant.pilot.closed');return {pilot:publicPilot(rows[0])};
 });
}
export async function getPilot({businessId,pilotId},injected={}){
 const d={...defaults,...injected};
 const {rows}=await d.query(`WITH pilot AS(SELECT * FROM merchant_pilots WHERE business_id=$1 AND id=$2),
 bounds AS(SELECT started_at AS start_at,GREATEST(started_at,LEAST(planned_end_at,COALESCE(closed_at,$3),$3)) AS end_at FROM pilot),
 windows AS(SELECT 'current' AS period,start_at,end_at FROM bounds UNION ALL SELECT 'previous',start_at-(end_at-start_at),start_at FROM bounds),
 purchases AS(SELECT w.period,t.customer_id,t.amount_q FROM transactions t
 JOIN customers c ON c.business_id=$1 AND c.id=t.customer_id AND c.deleted_at IS NULL
 JOIN windows w ON t.created_at>=w.start_at AND t.created_at<w.end_at
 WHERE t.business_id=$1 AND ${reportingPurchase('t')}),
 customer_counts AS(SELECT period,customer_id,count(*) AS purchases FROM purchases GROUP BY period,customer_id),
 periods AS(SELECT w.period,jsonb_build_object(
 'purchases',(SELECT count(*)::int FROM purchases p WHERE p.period=w.period),
 'recorded_sales_q',COALESCE((SELECT sum(amount_q) FROM purchases p WHERE p.period=w.period),0),
 'active_customers',(SELECT count(*)::int FROM customer_counts c WHERE c.period=w.period),
 'repeat_customers',(SELECT count(*)::int FROM customer_counts c WHERE c.period=w.period AND c.purchases>=2),
 'new_customers',(SELECT count(*)::int FROM customers c WHERE c.business_id=$1 AND c.deleted_at IS NULL AND c.imported_at IS NULL AND c.created_at>=w.start_at AND c.created_at<w.end_at),
 'redemptions',(SELECT count(*)::int FROM redemptions r JOIN customers c ON c.id=r.customer_id AND c.business_id=$1 AND c.deleted_at IS NULL WHERE r.business_id=$1 AND r.status='REDEEMED' AND COALESCE(r.redeemed_at,r.created_at)>=w.start_at AND COALESCE(r.redeemed_at,r.created_at)<w.end_at)
 ) AS data FROM windows w)
 SELECT to_jsonb(p) AS pilot,to_jsonb(b) AS bounds,
 (SELECT jsonb_object_agg(period,data) FROM periods) AS metrics,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('key',check_key,'status',status,'note',note,'updated_at',updated_at)) FROM merchant_pilot_checks WHERE business_id=$1 AND pilot_id=$2),'[]'::jsonb) AS checks
 FROM pilot p CROSS JOIN bounds b`,[businessId,pilotId,d.now()]);
 if(!rows[0])throw notFound('Piloto no encontrado.');
 const row=rows[0],start=new Date(row.bounds.start_at),end=new Date(row.bounds.end_at);
 return {pilot:publicPilot(row.pilot),checks:pilotChecksForVersion(row.pilot.checklist_version).map(c=>({...c,...row.checks.find(s=>s.key===c.key),evidence_type:'owner_reported'})),results:{
  period:{start:iso(start),end:iso(end),previous_start:iso(new Date(start.getTime()-(end.getTime()-start.getTime()))),previous_end:iso(start)},
  current:row.metrics.current,previous:row.metrics.previous,
  limitation:'Comparación observada entre períodos de igual duración. No demuestra que el piloto causó el cambio. Solo incluye actividad registrada en PF y excluye compras revertidas y clientes eliminados. Los clientes importados no cuentan como altas nuevas y los saldos iniciales no cuentan como compras.'
 }};
}
