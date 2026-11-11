const fingerprint='a'.repeat(64);let mode={mode:'normal',until:null,version:'b'.repeat(64)};
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
  if(body.version!==mode.version)throw new Error('El estado cambió. Actualiza la bandeja.');
  mode={mode:body.mode,until:body.mode==='busy'?new Date(Date.now()+Number(body.minutes)*60000).toISOString():null,version:mode.version==='b'.repeat(64)?'c'.repeat(64):'b'.repeat(64)};return{ok:true,operating_mode:structuredClone(mode)};
 }
 if(url.pathname==='/api/admin/decisions/review'&&method==='POST'){
  if(!fixtures.some(item=>item.key===body.decision_key)||body.fingerprint!==fingerprint)throw new Error('Actualiza la evidencia.');
  const old=reviews.get(body.decision_key);if(body.version!==(old?.version??0))throw new Error('Otra sesión revisó este pendiente.');
  reviews.set(body.decision_key,{status:body.status,version:(old?.version??0)+1,until:body.status==='snoozed'?new Date(Date.now()+body.snooze_hours*3600000).toISOString():null});return{ok:true};
 }
 const decisions=fixtures.map(item=>{const r=reviews.get(item.key);const state=r?.status==='reviewed'?'reviewed':r?.status==='snoozed'&&Date.parse(r.until)>Date.now()?'snoozed':'open';return{...item,fingerprint,evidence:{example:true},review_version:r?.version??0,review_state:state,snoozed_until:state==='snoozed'?r.until:null};});
 return{ok:true,generated_at:new Date().toISOString(),data_readiness:{state:'recorded_only',inactivity_allowed:true,summary:'Ejemplo: se observan únicamente las compras registradas en PF. Sin una conexión completa de caja, no se conocen todas las ventas del negocio.',last_completed_at:null},operating_mode:{...mode,mode:mode.mode==='busy'&&Date.parse(mode.until)>Date.now()?'busy':'normal'},decisions,summary:{open:decisions.filter(x=>x.review_state==='open').length,snoozed:decisions.filter(x=>x.review_state==='snoozed').length,reviewed:decisions.filter(x=>x.review_state==='reviewed').length},collisions:{overlapping_pairs:1,reviewed_campaigns:2,total_active_campaigns:2,recently_contacted:4,contact_days:7,note:'Ejemplo: las campañas comparten participantes. Esto no demuestra que sus beneficios puedan combinarse.',pairs:[{first_name:'Segunda visita',second_name:'Tarde de café',shared_customers:8}]}};
}
