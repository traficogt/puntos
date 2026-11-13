let sequence=0;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const actionButton=(text,fn)=>{const el=node('button',text);el.type='button';el.addEventListener('click',fn);return el;};
const titles={signup:'Inscripción',earn:'Compra ficticia',ineligibility:'Intento rechazado',unlock:'Desbloqueo',redeem:'Canje ficticio',refund:'Devolución ficticia'};
export function mountServiceOperations({container,api}){
 const prefix=`persistent-practice-${++sequence}`,root=node('section'),brief=node('div'),practice=node('details'),feedback=node('p');practice.className='service-briefing-practice';practice.append(node('summary','Practicar el recorrido completo'));root.append(brief,practice,feedback);container.append(root);feedback.setAttribute('role','status');
 let destroyed=false,busy=false,pending=null,session=null,configuration=null;
 const base='/api/staff/service-operations';
 function labeled(label,control,suffix){control.id=`${prefix}-${suffix}`;const el=node('label',label);el.htmlFor=control.id;return [el,control];}
 async function save(action,input={}){if(busy||destroyed)return;busy=true;feedback.textContent='Guardando…';root.querySelectorAll('button').forEach(el=>{el.disabled=true;});
  const payload=action==='start'?{}:{version:session.version,action,...input},key=JSON.stringify([session?.id,action,payload]);if(pending?.key!==key)pending={key,requestId:crypto.randomUUID()};
  try{const result=await api(action==='start'?`${base}/rehearsal`:`${base}/rehearsal/${session.id}/step`,{method:'POST',body:JSON.stringify({...payload,requestId:pending.requestId})});session=result.session;pending=null;feedback.textContent='Paso ficticio guardado.';}
  catch(e){feedback.textContent=e.message||'No se guardó. Puedes reintentar el mismo paso.';feedback.setAttribute('role','alert');}
  finally{busy=false;if(!destroyed){renderPractice();brief.querySelectorAll('button').forEach(el=>{el.disabled=false;});}}
 }
 function renderPractice(){
  const open=practice.open;practice.replaceChildren(node('summary','Practicar el recorrido completo'));practice.open=open;
  practice.append(node('p','Cliente ficticio desde cero. El avance queda guardado para tu usuario; no cambia clientes, puntos, inventario ni mensajes reales.'));
  practice.append(node('p','Simula la regla base, sucursal, disponibilidad y saldo guardados. Las promociones personalizadas, caja y Wallet se prueban aparte.'));
  for(const blocker of configuration?.readiness?.blockers??[])practice.append(node('p',blocker));
  if(configuration?.current===false)practice.append(node('p','La configuración cambió: inicia una nueva práctica para comprobarla.'));
  if(!session){practice.append(actionButton('Iniciar práctica guardada',()=>save('start')));return;}
  const state=session.state,rewards=state.config.rewards,select=node('select');for(const reward of rewards)select.add(new Option(`${reward.name} · ${reward.points_cost} puntos`,reward.id));
  practice.append(node('p',`Cliente ficticio · ${state.points} puntos`),...labeled('Recompensa para practicar',select,'reward'));
  if(!state.signed_up)practice.append(actionButton('Simular inscripción',()=>save('signup')));
  else{
   practice.append(node('p','Comprueba el rechazo antes de ganar puntos o con una recompensa no disponible.'),actionButton('Comprobar intento no elegible',()=>save('ineligibility',{rewardId:select.value})));
   const quantity=node('input');quantity.type='number';quantity.min=state.config.program_type==='SPEND'?'0.01':'1';quantity.step=state.config.program_type==='SPEND'?'0.01':'1';quantity.max='1000000';quantity.value='1';
   const label=state.config.program_type==='SPEND'?'Importe de compra ficticia':state.config.program_type==='VISIT'?'Visitas ficticias':'Artículos ficticios';practice.append(...labeled(label,quantity,'quantity'),actionButton('Registrar compra ficticia',()=>save('earn',{quantity:Number(quantity.value)})));
   const actions=node('div');actions.className='service-briefing-actions';const unlock=actionButton('Comprobar desbloqueo',()=>save('unlock',{rewardId:select.value})),redeem=actionButton('Canjear en práctica',()=>save('redeem',{rewardId:select.value})),refund=actionButton('Devolver canje ficticio',()=>save('refund'));
   redeem.disabled=!!state.redemption;refund.disabled=!state.redemption;actions.append(unlock,redeem,refund);practice.append(actions);
  }
  const history=node('ol');for(const entry of state.history)history.append(node('li',`${titles[entry.action]}${entry.outcome==='insufficient_points'?' · saldo insuficiente':entry.outcome!=='completed'?' · no disponible según configuración':entry.points?` · ${entry.points} puntos`:''}`));practice.append(history);
  if(state.complete)practice.append(node('p','Recorrido ficticio completo guardado: inscripción, rechazo, compra, desbloqueo, canje y devolución.'));
  practice.append(actionButton('Iniciar otra práctica',()=>save('start')));
 }
 async function refresh(){
  feedback.textContent='Consultando resumen y práctica…';const results=await Promise.allSettled([api(`${base}/briefing`),api(`${base}/rehearsal`)]);if(destroyed)return;
  const [summary,rehearsal]=results;brief.replaceChildren(node('h3','Cambios de la operación'));
  if(summary.status==='fulfilled'){
   const row=summary.value.briefing,payload=row.payload;brief.append(node('p',`Versión ${row.version}${row.acknowledged?' · Lectura confirmada':' · Por leer'}`),node('p',`Regla vigente: ${payload.rules.rate} puntos ${payload.rules.program_type==='VISIT'?'por visita':payload.rules.program_type==='ITEM'?'por artículo':'por unidad monetaria'}.`));
   const list=node('ul');for(const offer of payload.offers)list.append(node('li',`${offer.name} · ${offer.bonus_points} puntos adicionales`));for(const reward of payload.unavailable_rewards)list.append(node('li',`${reward.name}: no disponible. Alternativas aprobadas: ${reward.alternatives.map(r=>`${r.name}${r.available?'':' (no disponible)'}`).join(', ')||'ninguna'}.`));
   brief.append(list,node('p',`${payload.cases.reduce((sum,c)=>sum+c.count,0)} casos pendientes; ${payload.cases.reduce((sum,c)=>sum+c.escalated,0)} escalados.`));
   if(!row.acknowledged)brief.append(actionButton('Confirmar lectura de esta versión',async()=>{if(busy)return;busy=true;try{await api(`${base}/briefing/${row.id}/ack`,{method:'POST',body:JSON.stringify({version:row.version})});await refresh();}catch(e){feedback.textContent=e.message;}finally{busy=false;}}));
  }else brief.append(node('p','No se pudo consultar el resumen.'),actionButton('Recargar resumen',refresh));
  if(rehearsal.status==='fulfilled'){configuration=rehearsal.value;session=configuration.session;renderPractice();}else practice.append(node('p','No se pudo cargar tu práctica guardada.'),actionButton('Reintentar práctica',refresh));
  feedback.textContent=results.some(r=>r.status==='rejected')?'Alguna información no pudo cargarse. Reintenta con conexión.':'';
 }
 refresh();return {refresh,destroy(){destroyed=true;root.remove();}};
}
