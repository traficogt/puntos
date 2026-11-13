// Fictional, session-only examples. No customer or supplier is contacted.
const at='2026-11-12T14:00:00.000Z',region={country:'GT',currency:'GTQ',timezone:'America/Guatemala',locale:'es-GT',minorUnits:2};
const topics=[{id:'sample-demand-coffee',topic:'Café sin azúcar',category:'product',status:'new',version:1,member_count:3,staff_observations:1,follow_up_at:null,product_context:'Bebidas',created_at:at}];
const notes=[{id:'sample-request-1',source:'customer',customer_id:'sample-member',customer_name:'Lucía (ejemplo)',note:'Me gustaría encontrar otra opción sin azúcar.',created_at:at}];
const demandEvents=new Map(),claimEvents=new Map(),requests=new Map();
const agreements=[{id:'sample-supplier-agreement',supplier_name:'Proveedor de café (ejemplo)',title:'Aporte por café entregado',reward_ids:['sample-funded-coffee'],starts_at:'2026-11-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z',currency:'GTQ',minor_units:2,unit_amount_minor:500,cap_minor:2500,closed_at:null,reserved_minor:0}];
const claims=[],rewards=[{id:'sample-funded-coffee',name:'Café de la casa (ejemplo)'}],redemptions=[{id:'sample-funded-redemption',reward_id:rewards[0].id,reward_name:rewards[0].name,redeemed_at:at,recorded_at:at,method:'manual'}];
const copy=value=>structuredClone(value),pagination={offset:0,limit:50,has_more:false};
function remember(body,path,fn){const key=JSON.stringify([path,body]),prior=requests.get(body.request_id);if(prior){if(prior.key!==key)throw new Error('La referencia ya se usó para otra acción.');return copy({...prior.result,replay:true});}const result=fn();requests.set(body.request_id,{key,result:copy(result)});return copy(result);}
export function demoDemandFunding(url,options={}){
 const method=options.method??'GET',path=url.pathname,body=JSON.parse(options.body??'{}');
 if(path.startsWith('/api/admin/demand-notebook')){
  const [,id,action]=path.slice('/api/admin/demand-notebook'.length).split('/');
  if(!id){const status=url.searchParams.get('status')??'all';return copy({ok:true,topics:topics.filter(t=>status==='all'||t.status===status),pagination});}
  const topic=topics.find(t=>t.id===id);if(!topic)throw new Error('Tema de ejemplo no encontrado.');
  if(method==='GET')return copy({ok:true,topic,requests:notes,events:demandEvents.get(id)??[]});
  if(action==='triage')return remember(body,path,()=>{if(topic.version!==body.version)throw new Error('El tema cambió. Actualiza.');topic.status=body.status;topic.version++;topic.follow_up_at=body.follow_up_at;const events=demandEvents.get(id)??[];events.unshift({version:topic.version,created_at:new Date().toISOString(),details:body});demandEvents.set(id,events);return{ok:true,topic};});
 }
 const base='/api/admin/supplier-funding',suffix=path.slice(base.length),parts=suffix.split('/').filter(Boolean);
 if(!suffix&&method==='GET'){for(const a of agreements)a.reserved_minor=claims.filter(c=>c.agreement_id===a.id&&c.status!=='rejected').reduce((n,c)=>n+c.amount_minor,0);return copy({ok:true,region,rewards,agreements,claims,pagination,summary:[{currency:'GTQ',minor_units:2,cap_minor:agreements.reduce((n,a)=>n+a.cap_minor,0),reserved_minor:agreements.reduce((n,a)=>n+a.reserved_minor,0),available_minor:agreements.filter(a=>!a.closed_at).reduce((n,a)=>n+a.cap_minor-a.reserved_minor,0),approved_minor:claims.filter(c=>c.status==='approved').reduce((n,c)=>n+c.amount_minor,0),paid_minor:claims.filter(c=>c.status==='paid').reduce((n,c)=>n+c.amount_minor,0)}]});}
 if(parts[0]==='agreements'){
  if(parts.length===1&&method==='POST')return remember(body,path,()=>{const a={id:crypto.randomUUID(),...body,starts_at:body.starts_at??`${body.starts_on}T06:00:00Z`,ends_at:body.ends_at??`${body.ends_on}T06:00:00Z`,minor_units:2,unit_amount_minor:Math.round(body.unit_amount*100),cap_minor:Math.round(body.cap_amount*100),reserved_minor:0,closed_at:null};agreements.unshift(a);return{ok:true,agreement:a};});
  const a=agreements.find(v=>v.id===parts[1]);if(!a)throw new Error('Acuerdo de ejemplo no encontrado.');
  if(parts[2]==='close'){a.closed_at=new Date().toISOString();return copy({ok:true,agreement:a});}
  if(parts[2]==='eligible')return copy({ok:true,redemptions:a.closed_at?[]:redemptions.filter(r=>a.reward_ids.includes(r.reward_id)&&!claims.some(c=>c.redemption_id===r.id)),pagination});
  if(parts[2]==='export')return{ok:true,filename:'reclamaciones-ejemplo.csv',csv:'claim_id,reward,amount_minor,currency,status\r\n'+claims.filter(c=>c.agreement_id===a.id).map(c=>[c.id,c.evidence.reward_name,c.amount_minor,c.currency,c.status].join(',')).join('\r\n')};
  if(parts[2]==='claims')return remember(body,path,()=>{const r=redemptions.find(r=>r.id===body.redemption_id);if(!r||a.closed_at||claims.some(c=>c.redemption_id===r.id)||a.reserved_minor+a.unit_amount_minor>a.cap_minor)throw new Error('No hay entrega o presupuesto elegible.');const c={id:crypto.randomUUID(),agreement_id:a.id,redemption_id:r.id,supplier_name:a.supplier_name,agreement_title:a.title,currency:a.currency,amount_minor:a.unit_amount_minor,version:1,status:'draft',requires_review:false,evidence:{reward_name:r.reward_name,fulfilled_at:r.recorded_at,kind:'staff_attested_pos'}};claims.unshift(c);a.reserved_minor+=c.amount_minor;claimEvents.set(c.id,[{version:1,created_at:at,details:{status:'draft'}}]);return{ok:true,claim:c};});
 }
 if(parts[0]==='claims'){
  const c=claims.find(c=>c.id===parts[1]);if(!c)throw new Error('Reclamación de ejemplo no encontrada.');
  if(method==='GET')return copy({ok:true,claim:c,events:claimEvents.get(c.id)});
  if(parts[2]==='transition')return remember(body,path,()=>{const transitions={draft:['submitted','rejected'],submitted:['approved','rejected'],approved:['paid','rejected'],rejected:['submitted'],paid:[]};if(c.version!==body.version||!transitions[c.status].includes(body.status))throw new Error('La reclamación cambió. Actualiza.');if(body.status==='paid'&&(body.paid_minor!==c.amount_minor||!body.paid_at))throw new Error('El importe recibido debe coincidir con el aprobado.');c.status=body.status;c.version++;if(c.status==='paid'){c.paid_minor=body.paid_minor;c.paid_at=body.paid_at;c.payment_reference=body.reference;}claimEvents.get(c.id).push({version:c.version,created_at:new Date().toISOString(),details:body});return{ok:true,claim:c};});
 }
 throw new Error('Acción no disponible en la demostración.');
}
