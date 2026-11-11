// Fictional in-memory state. Never calls an API or persists business data.
const team=[{id:'demo-ana',name:'Ana (ficticia)',role:'CASHIER',branch_id:'demo-centro'},{id:'demo-luis',name:'Luis (ficticio)',role:'MANAGER',branch_id:'demo-centro'}];
const branches=[{id:'demo-centro',name:'Centro (demostración)'}];
const grants=[{id:'demo-authority',staff_id:'demo-ana',staff_name:'Ana (ficticia)',branch_id:'demo-centro',branch_name:'Centro (demostración)',action:'restore_redemption',per_action_points:50,total_points:200,used_points:50,remaining_points:150,starts_at:new Date(Date.now()-3600000).toISOString(),ends_at:new Date(Date.now()+7*3600000).toISOString(),created_at:new Date().toISOString(),revoked_at:null}];
const notices=[{id:'demo-notice',title:'Antes de entregar una recompensa',body:'Confirma el código de canje y registra la entrega. Si hubo un error, revisa el caso antes de restaurar puntos.',branch_id:null,version:1,acknowledgements:1,expires_at:new Date(Date.now()+24*3600000).toISOString(),updated_at:new Date().toISOString()}];
const usage=[{id:'demo-usage',grant_id:'demo-authority',staff_id:'demo-ana',staff_name:'Ana (ficticia)',points:50,action:'restore_redemption',owner_bypass:false,remaining_points:150,created_at:new Date(Date.now()-1800000).toISOString()}];
const creationRequests=new Map();
const freshId=()=>globalThis.crypto.randomUUID();
const validDate=value=>typeof value==='string'&&Number.isFinite(new Date(value).getTime());
export function demoStaffDelegation(url,options={}){
 const method=options.method||'GET',body=JSON.parse(options.body||'{}'),base='/api/admin/staff-authority',noticeBase='/api/admin/shift-notices';
 if(url.pathname===base&&method==='GET'){
  const offset=Number(url.searchParams.get('offset')||0);return structuredClone({ok:true,staff:team,branches,grants:grants.slice(offset,offset+50).map(row=>({...row,server_now:new Date().toISOString()})),usage,pagination:{offset,has_more:grants.length>offset+50},history_limit:50});
 }
 if(url.pathname===base&&method==='POST'){
  if(typeof body.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))throw new Error('La referencia de esta autorización no es válida.');
  const allowed=new Set(['request_id','staff_id','branch_id','action','per_action_points','total_points','starts_at','ends_at']);if(Object.keys(body).some(key=>!allowed.has(key)))throw new Error('Revisa los datos de la autorización.');
  const person=team.find(row=>row.id===body.staff_id),branch=branches.find(row=>row.id===body.branch_id);
  if(!person||body.action!=='restore_redemption'||!Number.isInteger(body.per_action_points)||body.per_action_points<1||body.per_action_points>100000||!Number.isInteger(body.total_points)||body.total_points<body.per_action_points||body.total_points>1000000||!validDate(body.starts_at)||!validDate(body.ends_at)||new Date(body.ends_at)<=new Date(body.starts_at)||new Date(body.ends_at)-new Date(body.starts_at)>31*86400000||(body.branch_id&&(!branch||person.branch_id!==branch.id)))throw new Error('Revisa los límites, las fechas y la persona.');
  const requestId=body.request_id.toLowerCase(),fingerprint=JSON.stringify([body.staff_id,body.branch_id??null,body.action,body.per_action_points,body.total_points,new Date(body.starts_at).toISOString(),new Date(body.ends_at).toISOString()]);
  const prior=creationRequests.get(requestId);
  if(prior){if(prior.fingerprint!==fingerprint)throw new Error('Esta referencia ya se usó para una autorización con otros límites o condiciones.');return structuredClone({ok:true,grant:grants.find(row=>row.id===prior.grantId),replay:true});}
  const grant={...body,request_id:requestId,id:freshId(),staff_name:person.name,branch_name:branch?.name??null,used_points:0,remaining_points:body.total_points,revoked_at:null,created_at:new Date().toISOString()};grants.unshift(grant);creationRequests.set(requestId,{fingerprint,grantId:grant.id});return structuredClone({ok:true,grant,replay:false});
 }
 if(url.pathname.startsWith(`${base}/`)&&url.pathname.endsWith('/revoke')&&method==='POST'){
  const row=grants.find(value=>`${base}/${value.id}/revoke`===url.pathname);if(!row)throw new Error('No encontramos la autorización.');row.revoked_at||=new Date().toISOString();return {ok:true,grant_id:row.id};
 }
 if(url.pathname===noticeBase&&method==='GET')return structuredClone({ok:true,notices});
 if((url.pathname===noticeBase&&method==='POST')||(url.pathname.startsWith(`${noticeBase}/`)&&method==='PUT')){
  if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.body!=='string'||!body.body.trim()||body.body.length>600||!validDate(body.expires_at)||/[<>]|\S+@\S+|(?:\d[\s()+.-]*){8,}/.test(`${body.title} ${body.body}`))throw new Error('Escribe un aviso breve sin datos de clientes.');
  let notice=method==='PUT'?notices.find(row=>`${noticeBase}/${row.id}`===url.pathname):null;
  if(method==='PUT'&&(!notice||notice.version!==body.expected_version))throw new Error('El aviso cambió. Actualiza antes de editar.');
  const data={title:body.title.trim(),body:body.body.trim(),branch_id:body.branch_id??null,expires_at:body.expires_at,acknowledgements:0,updated_at:new Date().toISOString()};
  if(notice)Object.assign(notice,data,{version:notice.version+1});else{notice={...data,id:freshId(),version:1};notices.unshift(notice);}return structuredClone({ok:true,notice});
 }
 throw new Error('Acción de equipo no disponible en la demostración.');
}
