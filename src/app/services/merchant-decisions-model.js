import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function operatingMode(business={},now=new Date()){
 const raw=business.program_json?.merchant_operating_mode??{};
 const valid=typeof raw.until==='string'&&Number.isFinite(Date.parse(raw.until));
 const until=valid?new Date(raw.until).toISOString():null;
 const capacity=Number.isInteger(raw.capacity)&&raw.capacity>=0?raw.capacity:null;
 return{mode:['busy','quiet'].includes(raw.mode)&&until&&Date.parse(until)>now.getTime()?raw.mode:'normal',until,capacity,version:digest({mode:raw.mode??'normal',until,...(capacity!==null?{capacity}:{})})};
}
/** @param {{operations?:any,readiness?:any,cases?:any,collisions?:any,outcomes?:any[],reviews?:any[],now?:Date}} options */
export function buildDecisions({operations={sections:[]},readiness=null,cases={open:0},collisions={overlapping_pairs:0},outcomes=[],reviews=[],now=new Date()}){
 const items=[];
 const add=(key,priority,title,explanation,evidence,action)=>items.push({key,priority,title,explanation,evidence,action,impact:{description:explanation,cost_state:'unknown',cost:null,cost_note:'El costo de atender este pendiente no está registrado. La evidencia no demuestra ventas futuras ni ahorro.'},fingerprint:digest({key,evidence})});
 if(readiness?.state==='blocked')add('data-freshness',1,'Completa los datos antes de contactar clientes',readiness.summary,{reason:readiness.reason,last_completed_at:readiness.last_completed_at},readiness.action);
 if(Number(cases.open)>0)add('service-cases',2,'Resuelve las recompensas pendientes de atención',`${cases.open} casos siguen abiertos. Una solución debe quedar registrada con el cliente y la persona responsable.`,{open:Number(cases.open),oldest_at:cases.oldest_at??null,last_changed_at:cases.last_changed_at??null},{label:'Atender casos',href:'#casos'});
 for(const section of operations.sections??[])if(section.state==='needs_attention')add(`operation-${section.id}`,3,section.title,section.summary,{reasons:section.reasons??[],metrics:section.metrics??[]},section.action);
 if(Number(collisions.overlapping_pairs)>0)add('campaign-overlap',4,'Revisa clientes con más de una oferta activa',`${collisions.overlapping_pairs} pares de campañas comparten participantes. Esto no demuestra que sus beneficios se puedan combinar.`,{overlapping_pairs:collisions.overlapping_pairs,pairs:collisions.pairs??[],recently_contacted:collisions.recently_contacted??0},{label:'Revisar campañas',href:'#ofertas'});
 for(const item of outcomes)if(!items.some(existing=>existing.key===item.key)){
  add(item.key,item.priority,item.title,item.explanation,item.evidence,item.action);
  Object.assign(items.at(-1),{observed_at:item.observed_at,period:item.period});
 }
 return items.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key)).map(item=>{
  const review=reviews.find(row=>row.decision_key===item.key),same=review?.evidence_fingerprint===item.fingerprint;
  const state=same&&['reviewed','dismissed'].includes(review.status)?review.status:same&&review.status==='snoozed'&&Date.parse(review.snoozed_until)>now.getTime()?'snoozed':'open';
  return{...item,review_state:state,review_version:review?.version??0,assigned_staff_id:review?.assigned_staff_id??null,assigned_staff_name:review?.assigned_staff_name??null,dismiss_reason:state==='dismissed'?review.dismiss_reason:null,evidence_changed:!!review&&!same,snoozed_until:state==='snoozed'?new Date(review.snoozed_until).toISOString():null};
 });
}
