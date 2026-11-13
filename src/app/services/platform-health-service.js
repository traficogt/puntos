import {dbQuery,getDbPlatformAdmin} from '../database.js';
import {forbidden} from '../../utils/http-error.js';
import {readinessForBusiness} from './merchant-data-readiness.js';

export async function getPlatformOperationsHealth({limit=25,offset=0},injected={}){
 const d={query:dbQuery,isPlatformAdmin:getDbPlatformAdmin,now:()=>new Date(),...injected};
 if(!d.isPlatformAdmin())throw forbidden('Se requiere administración de plataforma.');
 const now=d.now();
 const {rows}=await d.query(`WITH page AS (
 SELECT id,name,slug,program_json FROM businesses ORDER BY name,id LIMIT $1 OFFSET $2
 ) SELECT b.*,
 (SELECT jsonb_object_agg(br.id::text,br.name) FROM branches br WHERE br.business_id=b.id) AS branch_names,
 (SELECT count(*)::int FROM customers c WHERE c.business_id=b.id AND c.deleted_at IS NULL) AS members,
 (SELECT max(t.created_at) FROM transactions t WHERE t.business_id=b.id AND t.type='PURCHASE') AS last_purchase_at,
 (SELECT count(*)::int FROM redemptions r WHERE r.business_id=b.id AND r.status='REDEEMED') AS recorded_redemptions,
 (SELECT count(*)::int FROM service_cases s WHERE s.business_id=b.id AND s.status='open') AS open_cases,
 (SELECT count(*)::int FROM service_cases s WHERE s.business_id=b.id AND s.kind='redemption_failed' AND s.created_at>$3::timestamptz-interval '7 days') AS failed_attempts_7d,
 (SELECT count(*)::int FROM growth_message_outbox m WHERE m.business_id=b.id AND m.status IN('failed','uncertain')) AS message_attention,
 (SELECT count(*)::int FROM native_wallet_passes p WHERE p.business_id=b.id AND p.revision>p.synced_revision AND p.attempts>0) AS wallet_attention
 FROM page b`,[Math.min(100,Math.max(1,limit)),Math.max(0,offset),now.toISOString()]);
 return {generated_at:now.toISOString(),limit,offset,businesses:rows.map(b=>{
  const readiness=readinessForBusiness(b,now),issues=[];
  readiness.sources=readiness.sources.map(source=>({...source,branch_name:source.branch_id?b.branch_names?.[source.branch_id]??null:null}));
  if(readiness.state==='blocked')issues.push({kind:'data',summary:readiness.summary,action:'Revisar la conexión y completar la sincronización.'});
  if(b.members>0&&b.recorded_redemptions===0)issues.push({kind:'activation',summary:'Hay miembros registrados y ningún canje completado registrado.',action:'Realizar el ensayo de lanzamiento y revisar los casos pendientes.'});
  if(b.failed_attempts_7d>0)issues.push({kind:'redemption',summary:`${b.failed_attempts_7d} intentos de canje con caso abierto o resuelto en siete días.`,action:'Revisar motivos y resoluciones antes de cambiar las recompensas.'});
  if(b.message_attention>0)issues.push({kind:'messaging',summary:`${b.message_attention} mensajes fallidos o de resultado incierto.`,action:'Revisar los registros del proveedor; evitar reenvíos duplicados.'});
  if(b.wallet_attention>0)issues.push({kind:'wallet',summary:`${b.wallet_attention} actualizaciones de tarjetas con intentos pendientes.`,action:'Revisar el servicio de actualización de billeteras.'});
  return {id:b.id,name:b.name,slug:b.slug,readiness,issues,state:issues.length?'needs_attention':'observed',members:b.members,
   recorded_redemptions:b.recorded_redemptions,open_cases:b.open_cases,last_purchase_at:b.last_purchase_at,
   note:'Los registros no demuestran todas las ventas ni la entrega de mensajes. La ausencia de compras no prueba una caída.'};
 }),next_offset:rows.length===limit?offset+limit:null};
}
