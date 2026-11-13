import {demoOperatingMode,setDemoOperatingMode} from './demo-owner-operating-state.js';
import {demoOperatingDrafts,demoActivateOperatingCampaign,demoOccupiedOperatingCapacity} from './demo-growth.js';
const fingerprint='a'.repeat(64);
const staff=[{id:'demo-manager-ana',name:'Ana',role:'MANAGER'},{id:'demo-cashier-luis',name:'Luis',role:'CASHIER'}],history=new Map(),templates=[],templateRequests=new Map(),activationRequests=new Map();
const reviews=new Map();
const fixtures=[
 {key:'service-cases',title:'Resuelve las recompensas pendientes de atención',explanation:'Ejemplo: dos clientes tienen una recompensa pendiente de resolución.',action:{label:'Atender casos',href:'#casos'}},
 {key:'operation-economics',title:'Completa los costos que faltan',explanation:'Ejemplo: una recompensa no tiene costo registrado. Desconocido no significa costo cero.',action:{label:'Revisar costos',href:'#costos'}},
 {key:'hospitality-unused',title:'Revisa las cortesías que vencieron sin usarse',explanation:'Ejemplo: 3 de 8 cortesías cuyo plazo terminó en los últimos 30 días vencieron sin entrega registrada. Su compromiso reservado de Q15 no es gasto realizado. Revisa el plazo y el beneficio antes de autorizar otra prueba.',observed_at:'2026-11-11T18:00:00Z',period:{days:30},action:{label:'Revisar cortesías',href:'#cortesias'}},
 {key:'redemption-follow-up',title:'Revisa las visitas después de canjear',explanation:'Ejemplo: 12 de 30 clientes con 30 días completos volvieron a comprar en otra fecha local. Otros 12 siguen en seguimiento y no entran en ese denominador. Se analizan canjes de los últimos 90 días. Esto no demuestra visitas causadas por la recompensa.',observed_at:'2026-11-11T18:00:00Z',period:{days:90},action:{label:'Ver seguimiento después del canje',href:'?ver=visitas-tras-canje#resumen'}}
];
export function demoDecisions(url,options={}){
 const method=options.method||'GET',body=options.body?JSON.parse(options.body):{};
 if(url.pathname==='/api/admin/decisions/operating-mode'&&method==='POST'){
  return{ok:true,operating_mode:setDemoOperatingMode(body)};
 }
 if(url.pathname==='/api/admin/decisions/review'&&method==='POST'){
  if(!fixtures.some(item=>item.key===body.decision_key)||body.fingerprint!==fingerprint)throw new Error('Actualiza la evidencia.');
  const old=reviews.get(body.decision_key);if(body.version!==(old?.version??0))throw new Error('Otra sesión revisó este pendiente.');
  if(body.status==='dismissed'&&(!body.dismiss_reason||body.dismiss_reason.trim().length<3))throw new Error('Escribe el motivo del descarte.');
  if(body.assigned_staff_id&&!staff.some(person=>person.id===body.assigned_staff_id))throw new Error('Selecciona una persona del ejemplo.');
  const assigned=body.assigned_staff_id===undefined?old?.assigned_staff_id??null:body.assigned_staff_id;
  const next={status:body.status,version:(old?.version??0)+1,assigned_staff_id:assigned,dismiss_reason:body.status==='dismissed'?body.dismiss_reason.trim():null,until:body.status==='snoozed'?new Date(Date.now()+body.snooze_hours*3600000).toISOString():null};
  reviews.set(body.decision_key,next);history.set(body.decision_key,[{...next,id:crypto.randomUUID(),actor_name:'Dueña de ejemplo',created_at:new Date().toISOString()},...(history.get(body.decision_key)??[])]);return{ok:true,version:next.version};
 }
 if(url.pathname.startsWith('/api/admin/decisions/history/'))return {ok:true,events:structuredClone(history.get(url.pathname.split('/').at(-1))??[])};
 if(url.pathname==='/api/admin/decisions/templates')return structuredClone({ok:true,authorized:true,permissions:{operating_mode:true,offer_template:true},operating_mode:demoOperatingMode(),templates,drafts:demoOperatingDrafts()});
 if(url.pathname==='/api/admin/decisions/templates/approve'&&method==='POST'){
  const previous=templateRequests.get(body.request_id);if(previous){if(previous.signature!==JSON.stringify(body))throw new Error('La referencia tiene otros términos.');return {ok:true,template:structuredClone(previous.template),replay:true};}
  const source=demoOperatingDrafts().find(c=>c.id===body.campaign_id),expires=new Date(body.expires_at);
  if(!source||source.estimated_cost_per_point_q==null||!Number.isInteger(body.maximum_runs)||body.maximum_runs<1||body.maximum_runs>100||!Number.isInteger(body.capacity)||body.capacity<1||body.capacity>200||!Number.isFinite(expires.getTime())||expires<=new Date()||expires.getTime()>Date.now()+31*86400000)throw new Error('Revisa el borrador, costo, capacidad y vigencia de la aprobación.');
  const maximum=Math.min(source.member_count,Math.floor(source.points_budget/source.bonus_points))*source.bonus_points;if(maximum/source.bonus_points>body.capacity)throw new Error('La capacidad no cubre los bonos aprobados.');
  const template={id:crypto.randomUUID(),name:source.name,source_campaign_id:source.id,audience_count:source.member_count,maximum_runs:body.maximum_runs,remaining_runs:body.maximum_runs,used_runs:0,version:1,capacity:body.capacity,expires_at:body.expires_at,revoked_at:null,terms:{currency:'GTQ',minor_units:2,maximum_commitment_points:maximum,bonus_points:source.bonus_points,points_budget:source.points_budget,minimum_purchase_q:source.minimum_purchase_q,duration_minutes:source.duration_minutes,estimated_cost_per_point_q:source.estimated_cost_per_point_q}};
  templates.unshift(template);templateRequests.set(body.request_id,{signature:JSON.stringify(body),template});return {ok:true,template:structuredClone(template),replay:false};
 }
 if(url.pathname==='/api/admin/decisions/templates/trigger'&&method==='POST'){
  const previous=activationRequests.get(body.request_id);if(previous){if(previous.signature!==JSON.stringify(body))throw new Error('La referencia corresponde a otra activación.');return {...structuredClone(previous.result),replay:true};}
  const template=templates.find(t=>t.id===body.template_id),mode=demoOperatingMode();if(!template||template.version!==body.version||template.revoked_at||new Date(template.expires_at)<=new Date()||template.remaining_runs<1)throw new Error('La aprobación cambió, venció o agotó sus activaciones.');
  if(mode.mode==='busy')throw new Error('Reanuda el negocio antes de activar una oferta.');
  const capacity=Math.min(template.capacity,mode.capacity??template.capacity);if(demoOccupiedOperatingCapacity()+template.terms.maximum_commitment_points/template.terms.bonus_points>capacity)throw new Error('Las ofertas vigentes ya ocupan la capacidad aprobada.');
  const campaign=demoActivateOperatingCampaign(template);template.used_runs++;template.remaining_runs--;template.version++;
  const result={ok:true,campaign,operating_mode:setDemoOperatingMode({mode:'quiet',minutes:template.terms.duration_minutes,capacity,version:mode.version}),replay:false};activationRequests.set(body.request_id,{signature:JSON.stringify(body),result});return structuredClone(result);
 }
 if(url.pathname==='/api/admin/decisions/templates/revoke'&&method==='POST'){
  const template=templates.find(t=>t.id===body.template_id);if(!template||template.version!==body.version||template.revoked_at)throw new Error('La aprobación cambió. Actualiza la lista.');template.revoked_at=new Date().toISOString();template.version++;return {ok:true};
 }
 const decisions=fixtures.map(item=>{const r=reviews.get(item.key);const state=['reviewed','dismissed'].includes(r?.status)?r.status:r?.status==='snoozed'&&Date.parse(r.until)>Date.now()?'snoozed':'open';return{...item,assigned_staff_id:r?.assigned_staff_id??null,assigned_staff_name:staff.find(person=>person.id===r?.assigned_staff_id)?.name??null,dismiss_reason:r?.dismiss_reason??null,impact:{cost_state:'unknown',cost_note:'El costo de la acción no está registrado en este ejemplo.'},fingerprint,evidence:{example:true},review_version:r?.version??0,review_state:state,snoozed_until:state==='snoozed'?r.until:null};});
 return{ok:true,generated_at:new Date().toISOString(),data_readiness:{state:'recorded_only',inactivity_allowed:true,summary:'Ejemplo: se observan únicamente las compras registradas en PF. Sin una conexión completa de caja, no se conocen todas las ventas del negocio.',last_completed_at:null},operating_mode:demoOperatingMode(),staff:structuredClone(staff),decisions,summary:{dismissed:decisions.filter(x=>x.review_state==='dismissed').length,open:decisions.filter(x=>x.review_state==='open').length,snoozed:decisions.filter(x=>x.review_state==='snoozed').length,reviewed:decisions.filter(x=>x.review_state==='reviewed').length},collisions:{overlapping_pairs:1,reviewed_campaigns:2,total_active_campaigns:2,recently_contacted:4,contact_days:7,note:'Ejemplo: las campañas comparten participantes. Esto no demuestra que sus beneficios puedan combinarse.',pairs:[{first_name:'Segunda visita',second_name:'Tarde de café',shared_customers:8}]}};
}
