// Fictional session-only data. No API calls, storage, messages or real entitlements.
const region={country:'GT',currency:'GTQ',timezone:'America/Guatemala',locale:'es-GT',minorUnits:2};
const rewards=[{id:'demo-promise-coffee',name:'Café de la casa',points_cost:80,stock:18,active:true,available:true,alternative_reward_ids:['demo-promise-tea'],protected_customers:6,unit_cost_q:5},{id:'demo-promise-tea',name:'Té de la casa',points_cost:80,stock:12,active:true,available:true,alternative_reward_ids:[],protected_customers:6,unit_cost_q:4}];
const staff=[{id:'demo-hospitality-ana',name:'Ana (ficticia)',branch_id:'demo-hospitality-centro'}],branches=[{id:'demo-hospitality-centro',name:'Centro (demostración)'}];
const now=()=>new Date().toISOString(),requests=new Map();
const grants=[{id:'demo-hospitality-grant',staff_id:staff[0].id,staff_name:staff[0].name,branch_id:branches[0].id,reward_id:rewards[0].id,reward_name:rewards[0].name,title:'Un café de cortesía',total_units:8,used_units:5,remaining_units:3,total_cost:40,used_cost:25,remaining_cost:15,unit_cost_limit:5,starts_at:new Date(Date.now()-55*3600000).toISOString(),ends_at:new Date(Date.now()+7*3600000).toISOString(),valid_hours:48,revoked_at:null}];
const history=Array.from({length:5},(_,i)=>({id:`demo-hospitality-issued-${i}`,grant_id:grants[0].id,title:'Un café de cortesía',reward_name:rewards[0].name,customer_name:`Cliente ficticio ${i+1}`,issued_at:new Date(Date.now()-(i===2?50:i<2?2+i:(i-2)/2)*3600000).toISOString(),expires_at:new Date(Date.now()+(48-(i===2?50:i<2?2+i:(i-2)/2))*3600000).toISOString(),redemption_id:i<2?`demo-hospitality-fulfilled-${i}`:null,fulfilled_cost:i===0?5:null})).sort((a,b)=>b.issued_at.localeCompare(a.issued_at));
function grantReport(grant,at){
 const rows=history.filter(row=>row.grant_id===grant.id),fulfilled=rows.filter(row=>row.redemption_id),known=fulfilled.filter(row=>row.fulfilled_cost!=null);
 return {...grant,report:{issued:rows.length,fulfilled:fulfilled.length,expired_unused:rows.filter(row=>!row.redemption_id&&row.expires_at<=at).length,pending:rows.filter(row=>!row.redemption_id&&row.expires_at>at).length,committed_cost:grant.used_cost,fulfilled_known_cost:known.length?known.reduce((sum,row)=>sum+row.fulfilled_cost,0):null,fulfilled_cost_known_units:known.length,fulfilled_cost_unknown_units:fulfilled.length-known.length}};
}
export function demoRewardHospitality(url,options={}){
 const method=options.method||'GET',body=JSON.parse(options.body||'{}'),path=url.pathname;
 if(path==='/api/admin/reward-promises'&&method==='GET')return structuredClone({ok:true,region,rewards,history:[]});
 if(path.startsWith('/api/admin/reward-promises/')&&path.endsWith('/availability')&&method==='PUT'){
  const row=rewards.find(r=>path===`/api/admin/reward-promises/${r.id}/availability`);if(!row||typeof body.available!=='boolean'||!Array.isArray(body.alternative_reward_ids)||body.alternative_reward_ids.some(id=>id===row.id||!rewards.some(r=>r.id===id)))throw new Error('Revisa las recompensas aprobadas.');Object.assign(row,body);return {ok:true};
 }
 if(path==='/api/admin/hospitality'&&method==='GET'){const at=now();return structuredClone({ok:true,region,grants:grants.map(grant=>grantReport(grant,at)),history,staff,branches,rewards,server_now:at});}
 if(path==='/api/admin/hospitality'&&method==='POST'){
  const previous=requests.get(body.request_id),key=JSON.stringify(body);if(previous){if(previous.key!==key)throw new Error('La solicitud ya tiene otras condiciones.');return structuredClone({ok:true,grant:grants.find(g=>g.id===previous.id),replay:true});}
  const person=staff.find(s=>s.id===body.staff_id),reward=rewards.find(r=>r.id===body.reward_id);
  if(!person||!reward||!body.request_id||!body.title?.trim()||!Number.isInteger(body.total_units)||body.total_units<1||body.total_cost<body.unit_cost_limit||body.unit_cost_limit<reward.unit_cost_q||body.branch_id&&body.branch_id!==person.branch_id||new Date(body.ends_at)<=new Date(body.starts_at))throw new Error('Revisa el beneficio, la persona y los límites.');
  const grant={...body,id:crypto.randomUUID(),staff_name:person.name,reward_name:reward.name,used_units:0,used_cost:0,remaining_units:body.total_units,remaining_cost:body.total_cost,revoked_at:null};grants.unshift(grant);requests.set(body.request_id,{id:grant.id,key});return structuredClone({ok:true,grant,replay:false});
 }
 if(path.startsWith('/api/admin/hospitality/')&&path.endsWith('/revoke')&&method==='POST'){const grant=grants.find(g=>path===`/api/admin/hospitality/${g.id}/revoke`);if(!grant)throw new Error('No encontramos la autorización.');grant.revoked_at||=now();return {ok:true};}
 throw new Error('Esta acción no está disponible en la demostración.');
}
