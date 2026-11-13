import {initialRehearsal,applyRehearsalAction} from '../../../public/staff/rehearsal-model.js';
const config={program_type:'VISIT',program_json:{points_per_visit:10},branch_id:null,rewards:[{id:'demo-coffee',name:'Café (ficticio)',description:'Un café de la casa',active:true,available:true,points_cost:80,stock:20,branch_ids:[]},{id:'demo-tea',name:'Té (ficticio)',description:'Té de la casa',active:true,available:false,points_cost:50,stock:0,branch_ids:[]}]};
let session=null,acknowledged=false;const requests=new Map();
export function demoServiceCompletion(url,options={}){
 const base='/api/admin/service-operations',suffix=url.pathname.slice(base.length),method=options.method??'GET',body=JSON.parse(options.body??'{}');
 if(suffix==='/briefing'&&method==='GET')return {ok:true,briefing:{id:'demo-auto-briefing',version:1,acknowledged,payload:{rules:{program_type:'VISIT',rate:10},rule_version:'demostración',offers:[{id:'demo-offer',name:'Visita entre semana (ficticia)',bonus_points:20}],unavailable_rewards:[{id:'demo-tea',name:'Té (ficticio)',alternatives:[{id:'demo-coffee',name:'Café (ficticio)',available:true}]}],cases:[{kind:'unavailable',count:2,escalated:1}]}}};
 if(suffix==='/briefing/demo-auto-briefing/ack'&&method==='POST'){acknowledged=true;return {ok:true};}
 if(suffix==='/rehearsal'&&method==='GET')return structuredClone({ok:true,session,config,current:true,readiness:{blockers:[],staff:[{role:'OWNER',count:1}],description_complete:true}});
 if(suffix==='/rehearsal'&&method==='POST'){if(session?.id===body.requestId)return structuredClone({ok:true,session,replay:true});session={id:body.requestId,version:1,state:initialRehearsal(config),created_at:new Date().toISOString(),completed_at:null};return structuredClone({ok:true,session});}
 if(suffix===`/rehearsal/${session?.id}/step`&&method==='POST'){
  const key=JSON.stringify(body),prior=requests.get(body.requestId);if(prior){if(prior.key!==key)throw new Error('Referencia usada para otro paso.');return structuredClone(prior.result);}
  if(body.version!==session.version)throw new Error('La práctica cambió. Recarga.');session.state=applyRehearsalAction(session.state,body);session.version++;if(session.state.complete)session.completed_at=new Date().toISOString();const result={ok:true,session:structuredClone(session)};requests.set(body.requestId,{key,result});return result;
 }
 throw new Error('Acción de práctica no disponible.');
}
