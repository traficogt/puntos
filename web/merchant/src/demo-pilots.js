import { pilotChecks, pilotChecksForVersion, currentPilotChecklistVersion } from './pilot-model.js';
const day=86400000,now=Date.now();
const pilots=[{id:'demo-pilot-finished',checklist_version:1,pos_profile:null,name:'Primer piloto de cafetería · ejemplo',duration_days:30,status:'completed',started_at:new Date(now-32*day).toISOString(),planned_end_at:new Date(now-2*day).toISOString(),closed_at:new Date(now-2*day).toISOString(),close_note:'Informe ficticio para mostrar el flujo; no es un caso de éxito real.',checks:pilotChecksForVersion(1).map(c=>({...c,status:c.required?'passed':'not_applicable',note:'Registro ficticio del responsable.',updated_at:new Date(now-2*day).toISOString(),evidence_type:'owner_reported'}))}];
const requests=new Map();
function detail(p){
 const start=Date.parse(p.started_at),end=Math.max(start,Math.min(Date.now(),Date.parse(p.planned_end_at),p.closed_at?Date.parse(p.closed_at):Infinity));
 const sample=p.id==='demo-pilot-finished',empty={recorded_sales_q:0,purchases:0,active_customers:0,repeat_customers:0,new_customers:0,redemptions:0};
 return {pilot:{...p,checks:undefined},checks:p.checks,results:{period:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),previous_start:new Date(start-(end-start)).toISOString(),previous_end:new Date(start).toISOString()},current:sample?{recorded_sales_q:4500,purchases:90,active_customers:60,repeat_customers:20,new_customers:35,redemptions:8}:empty,previous:sample?{recorded_sales_q:3600,purchases:75,active_customers:57,repeat_customers:14,new_customers:29,redemptions:5}:empty,limitation:'Datos ficticios. Comparación observada de períodos de igual duración; no demuestra causalidad ni resultados reales.'}};
}
export function demoPilots(url,options={}){
 const method=options.method||'GET',body=JSON.parse(options.body||'{}'),suffix=url.pathname.replace('/api/admin/pilots','');
 if(!suffix&&method==='GET'){const offset=Number(url.searchParams.get('offset')||0);return {pilots:pilots.slice(offset,offset+20).map(p=>detail(p).pilot),latest_completed:pilots.filter(p=>p.status==='completed').sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at))[0]?detail(pilots.filter(p=>p.status==='completed').sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at))[0]).pilot:null,total:pilots.length,limit:20,offset};}
 if(!suffix&&method==='POST'){
  const signature=JSON.stringify(body),prior=requests.get(body.request_id);if(prior){if(prior.signature!==signature)throw new Error('Solicitud ya utilizada con otros datos.');return {pilot:detail(prior.pilot).pilot};}
  if(pilots.some(p=>p.status==='active'))throw new Error('Ya tienes un piloto activo.');
  const p={id:crypto.randomUUID(),checklist_version:currentPilotChecklistVersion,pos_profile:body.pos_profile?structuredClone(body.pos_profile):null,name:body.name,duration_days:body.duration_days,status:'active',started_at:new Date().toISOString(),planned_end_at:new Date(Date.now()+body.duration_days*day).toISOString(),closed_at:null,close_note:'',checks:pilotChecks.map(c=>({...c,status:'pending',note:'',updated_at:null,evidence_type:'owner_reported'}))};pilots.unshift(p);requests.set(body.request_id,{signature,pilot:p});return {pilot:detail(p).pilot};
 }
 const [,id,action,key]=suffix.split('/'),p=pilots.find(v=>v.id===id);if(!p)throw new Error('Piloto de ejemplo no encontrado.');
 if(!action&&method==='GET')return detail(p);
 if(p.status!=='active')throw new Error('El piloto está cerrado.');
 if(action==='checks'&&method==='PUT'){
  const check=p.checks.find(c=>c.key===key);if(!check||!['pending','passed','failed','not_applicable'].includes(body.status)||(check.required&&body.status==='not_applicable')||(body.status!=='pending'&&!body.note?.trim()))throw new Error('Revisa la prueba y su nota.');
  Object.assign(check,{status:body.status,note:body.note,updated_at:new Date().toISOString()});return {ok:true};
 }
 if(action==='close'&&method==='POST'){
  if(body.outcome==='completed'&&!p.checks.every(c=>c.status==='passed'||(!c.required&&c.status==='not_applicable')))throw new Error('Completa las pruebas antes de cerrar.');
  if(!['completed','stopped'].includes(body.outcome)||(body.outcome==='stopped'&&!body.note?.trim()))throw new Error('Registra una conclusión.');
  Object.assign(p,{status:body.outcome,closed_at:new Date().toISOString(),close_note:body.note});return {pilot:detail(p).pilot};
 }
 throw new Error('Acción no disponible en la demostración.');
}
