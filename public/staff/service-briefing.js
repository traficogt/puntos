import {mountServiceOperations} from './service-operations.js';
/** Fictional practice keeps its state in this closure; it has no API dependency. */
export function createPracticeSession(program,rewards=[]){
 const type=program?.program_type,cfg=program?.program_json||{};
 if(!['SPEND','VISIT','ITEM'].includes(type))throw new Error('No hay una configuración disponible para practicar.');
 const rate=Number(type==='SPEND'?cfg.points_per_q??0.1:type==='VISIT'?cfg.points_per_visit??10:cfg.points_per_item??1);
 if(!Number.isFinite(rate)||rate<0||rate>100000)throw new Error('Revisa la configuración antes de practicar.');
 const round=type==='SPEND'&&['floor','round'].includes(cfg.round)?cfg.round:'ceil';
 const choices=rewards.filter(row=>row.active!==false&&Number.isSafeInteger(Number(row.points_cost))&&Number(row.points_cost)>0&&(!row.valid_until||new Date(row.valid_until)>new Date())).map(row=>({id:String(row.id),name:String(row.name),points_cost:Number(row.points_cost)}));
 let balance=200,redemption=null;
 return {
  snapshot:()=>({points:balance,redemption:redemption?{...redemption}:null,program:{type,rate,round},rewards:choices.map(row=>({...row}))}),
  earn(input={}){
   const quantity=Number(type==='SPEND'?input.amount:type==='VISIT'?input.visits:input.items);
   if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000)throw new Error('Ingresa un valor válido mayor que cero.');
   if(type!=='SPEND'&&!Number.isInteger(quantity))throw new Error('Ingresa un número entero.');
   const raw=quantity*rate,earned=type==='SPEND'?(round==='floor'?Math.floor(raw):round==='round'?Math.round(raw):Math.ceil(raw)):raw;
   if(!Number.isSafeInteger(earned)||balance+earned>2147483647)throw new Error('El resultado excede el límite de la práctica.');
   balance+=earned;return earned;
  },
  redeem(rewardId){
   const reward=choices.find(row=>row.id===rewardId);if(!reward)throw new Error('Selecciona una recompensa disponible.');
   if(redemption)throw new Error('Corrige el canje de práctica o reinicia antes de otro canje.');
   if(balance<reward.points_cost)throw new Error('No hay puntos ficticios suficientes. Practica una compra primero.');
   balance-=reward.points_cost;redemption={reward_id:reward.id,points:reward.points_cost};return reward.points_cost;
  },
  correct(){if(!redemption)throw new Error('Primero realiza un canje de práctica.');const restored=redemption.points;balance+=restored;redemption=null;return restored;},
  reset(){balance=200;redemption=null;}
 };
}
let mountNumber=0;
const actionNames={restore_redemption:'Restituir puntos',extend_promise:'Ampliar vigencia',fulfill_promise:'Entregar promesa',operating_mode:'Cambiar ritmo',offer_template:'Activar oferta aprobada',assigned_decision:'Atender decisión asignada'};
const format=value=>new Intl.NumberFormat('es-GT').format(value);
function element(tag,text,attrs={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;}
function button(text,fn,attrs={}){const node=element('button',text,{type:'button',...attrs});node.addEventListener('click',fn);return node;}
/** api follows public/lib.js: JSON request bodies are already stringified. */
export function mountServiceBriefing({container,api,program}){
 if(!container||typeof api!=='function')throw new TypeError('A container and API adapter are required.');
 const when=value=>new Intl.DateTimeFormat(program?.region?.locale,{dateStyle:'short',timeStyle:'short',timeZone:program?.region?.timezone}).format(new Date(value));
 const prefix=`service-briefing-${++mountNumber}`,root=element('section',undefined,{class:'service-briefing','aria-labelledby':`${prefix}-heading`});
 root.append(element('h2','Antes del turno',{id:`${prefix}-heading`}));
 const notices=element('div'),authority=element('div',undefined,{class:'service-briefing-authority'});root.append(notices,authority);container.replaceChildren(root);const operations=mountServiceOperations({container:root,api});
 let destroyed=false,refreshNumber=0;
 function showFailure(target,message){target.replaceChildren(element('p',message,{role:'alert'}),button('Volver a cargar',()=>refresh()));}
 async function refresh(){
  const generation=++refreshNumber;notices.replaceChildren(element('p','Consultando avisos…',{role:'status'}));authority.replaceChildren(element('p','Consultando tus autorizaciones…'));
  const [brief,allowance]=await Promise.allSettled([api('/api/staff/shift-briefing'),api('/api/staff/service-authority')]);
  if(destroyed||generation!==refreshNumber)return;
  if(brief.status==='rejected')showFailure(notices,'No pudimos cargar los avisos. Vuelve a intentarlo con conexión.');
  else{
   notices.replaceChildren();
   if(!brief.value.notices?.length)notices.append(element('p','Sin avisos nuevos para tu turno.',{class:'service-briefing-muted'}));
   for(const notice of brief.value.notices||[]){
    const article=element('article',undefined,{class:'service-briefing-notice'}),feedback=element('p','',{role:'status'});
    article.append(element('h3',notice.title),element('p',notice.body),element('p',`Versión ${notice.version} · vigente hasta ${when(notice.expires_at)}`,{class:'service-briefing-muted'}));
    const ack=button('Leí este aviso',async()=>{
     ack.disabled=true;feedback.textContent='Guardando confirmación…';
     try{await api(`/api/staff/shift-briefing/${encodeURIComponent(notice.id)}/ack`,{method:'POST',body:JSON.stringify({version:notice.version})});if(!destroyed){article.replaceChildren(element('p',`Lectura confirmada: ${notice.title}.`,{role:'status'}));}}
     catch(error){if(!destroyed){feedback.textContent=error.status===409?'El aviso cambió. Vuelve a cargar y lee la nueva versión.':'No se guardó la lectura. Revisa tu conexión y vuelve a intentar.';feedback.setAttribute('role','alert');ack.disabled=false;if(error.status===409)article.append(button('Cargar nueva versión',()=>refresh()));}}
    },{'aria-label':`Confirmar lectura: ${notice.title}`});article.append(ack,feedback);notices.append(article);
   }
  }
  if(allowance.status==='rejected')showFailure(authority,'No pudimos confirmar tus autorizaciones. Consulta al dueño antes de resolver un caso.');
  else{
   authority.replaceChildren(element('h3','Tu autorización para resolver canjes'));
   if(allowance.value.owner)authority.append(element('p','Tienes acceso como dueño. Cada restauración de puntos queda registrada.'));
   else if(!allowance.value.grants?.length)authority.append(element('p','Sin autorización vigente para restaurar puntos. Puedes revisar el caso y pedir ayuda al dueño.'));
   else for(const grant of allowance.value.grants)authority.append(element('p',`Acción ${actionNames[grant.action]||grant.action}: hasta ${format(grant.per_action_points)} puntos · ${format(grant.remaining_points)} disponibles; ${format(grant.remaining_actions??0)} acciones; costo disponible ${format(grant.remaining_cost??0)} · vence ${when(grant.ends_at)} (Guatemala).`));
  }
 }
 refresh();return {refresh,destroy(){operations.destroy();destroyed=true;refreshNumber++;root.remove();}};
}
