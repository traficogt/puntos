const labels={original_fulfilled:'Se entregó el beneficio original',alternative_accepted:'El cliente aceptó una alternativa',closed_with_reason:'Cerrar con motivo',points_restored:'Restituir los puntos del canje'};
const requiresAttestation=value=>['original_fulfilled','alternative_accepted'].includes(value);
function node(tag,text){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;}
export function mountServiceCases({container,api,getContext}){
 if(!container)return {contextChanged(){},showCase(){},destroy(){}};
 // Template is static; all server/customer text is assigned with textContent.
 container.innerHTML='<details><summary>Resolver una incidencia</summary><p class="small">Reporta un beneficio no disponible o revisa una resolución. Requiere conexión; estas acciones no se guardan en la cola sin internet.</p><p data-status role="status"></p><form data-report><label for="serviceRedemption">Canje relacionado</label><select id="serviceRedemption"><option value="">Sin canje completado</option></select><label for="serviceReason">Qué ocurrió</label><textarea id="serviceReason" required minlength="3" maxlength="500" rows="3"></textarea><p class="small">No incluyas teléfonos, documentos ni datos sensibles.</p><button type="submit">Registrar incidencia</button></form><div class="row mt-10"><button type="button" data-refresh>Actualizar casos</button></div><div data-cases></div><div data-detail></div></details>';
 const details=container.querySelector('details'),status=container.querySelector('[data-status]'),form=container.querySelector('[data-report]'),redemption=/** @type {HTMLSelectElement} */(container.querySelector('#serviceRedemption')),reason=/** @type {HTMLTextAreaElement} */(container.querySelector('#serviceReason')),reportButton=/** @type {HTMLButtonElement} */(form.querySelector('button')),list=container.querySelector('[data-cases]'),detail=container.querySelector('[data-detail]');
 let destroyed=false,busy=false,selection=null,reportPending=null,redemptions=[],detailRow=null,resolvePending=null,refreshSequence=0,detailSequence=0,updateResolutionControls=null;
 const online=()=>navigator.onLine&&getContext().online;
 function message(text){status.textContent=text;}
 function controls(){reportButton.disabled=busy||!online()||!getContext().customerId;updateResolutionControls?.();}
 function stable(payload,prior){const key=JSON.stringify(payload);return prior?.key===key?prior:{key,requestId:crypto.randomUUID()};}
 async function refresh(){
  if(destroyed)return;const context=getContext(),customerId=context.customerId,sequence=++refreshSequence;selection=customerId;
  controls();if(!online()){message('Conéctate para registrar o resolver una incidencia.');return;}
  if(!customerId){message('Selecciona un cliente para ver sus casos y canjes.');list.replaceChildren();return;}
  message('Consultando casos y canjes…');
  try{
   const [cases,completed]=await Promise.all([api(`/api/staff/service-cases?customerId=${encodeURIComponent(customerId)}`),api(`/api/staff/service-redemptions?customerId=${encodeURIComponent(customerId)}`)]);
   if(destroyed||sequence!==refreshSequence||getContext().customerId!==customerId)return;
   redemptions=completed.redemptions??[];redemption.replaceChildren(new Option('Sin canje completado',''));
   for(const row of redemptions)redemption.add(new Option(`${row.reward_name} · ${row.code||'Canje registrado'} · ${row.points_cost} puntos${row.points_restored?' (restituidos)':''}`,row.id));
   list.replaceChildren();for(const row of cases.cases??[]){const section=node('section');section.className='service-case-row';section.append(node('h3',row.evidence?.reward_name_at_report||'Incidencia de servicio'),node('p',row.reason));const button=node('button','Revisar caso');button.type='button';button.addEventListener('click',()=>openCase(row.id));section.append(button);list.append(section);}
   message(cases.cases?.length?'Casos pendientes de este cliente.':'Sin casos pendientes registrados para este cliente.');
  }catch(error){if(!destroyed&&sequence===refreshSequence)message(error.message||'No se pudieron consultar los casos. Vuelve a actualizar.');}
 }
 function contextChanged(){
  controls();if(destroyed)return;const current=getContext().customerId;
  if(current!==selection){selection=current;refreshSequence++;detailSequence++;updateResolutionControls=null;detailRow=null;detail.replaceChildren();list.replaceChildren();reason.value='';reportPending=null;resolvePending=null;if(details.open)refresh();}
  if(!online())message('Conéctate para registrar o resolver una incidencia.');
 }
 function renderDetail(row,restoration){
  detailRow=row;detail.replaceChildren();detail.append(node('h3','Resolver este caso'),node('p',row.reason));
  if(row.kind==='redemption_failed')detail.append(node('p','El intento rechazado no descontó puntos.'));
  detail.append(node('p','Las condiciones prometidas anteriormente no están documentadas. La entrega física debe confirmarse con el cliente.'));
  if(row.status!=='open'){detail.append(node('p','Este caso ya tiene una resolución guardada.'));return;}
  const resolveForm=node('form'),label=node('label','Cómo se resolvió'),select=node('select');label.htmlFor='serviceResolution';select.id='serviceResolution';
  for(const [value,text] of Object.entries(labels)){const option=new Option(text,value);option.disabled=value==='points_restored'&&(!row.redemption_id||!!restoration);select.add(option);}select.value='closed_with_reason';
  const textLabel=node('label','Motivo de la resolución'),text=node('textarea');textLabel.htmlFor='serviceResolutionReason';text.id='serviceResolutionReason';text.required=true;text.minLength=3;text.maxLength=500;text.rows=3;
  const confirmLabel=node('label'),confirmed=node('input');confirmed.type='checkbox';confirmed.id='serviceConfirmed';confirmLabel.htmlFor=confirmed.id;confirmLabel.append(confirmed,document.createTextNode('Confirmo lo descrito con el cliente.'));confirmLabel.hidden=true;
  const explanation=node('p'),save=node('button','Guardar resolución');save.type='submit';
  function update(){confirmLabel.hidden=!requiresAttestation(select.value);explanation.textContent=select.value==='points_restored'?'Solo se restituye el débito original verificado, una vez por canje. Requiere autorización vigente. No cambia existencias ni puntos ganados de por vida.':'';save.disabled=busy||!online()||text.value.trim().length<3||(requiresAttestation(select.value)&&!confirmed.checked);}
  select.addEventListener('change',()=>{confirmed.checked=false;update();});text.addEventListener('input',update);confirmed.addEventListener('change',update);
  updateResolutionControls=update;
  resolveForm.append(label,select,explanation,textLabel,text,confirmLabel,save);detail.append(resolveForm);update();
  resolveForm.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||!online()||row!==detailRow)return;const customerId=getContext().customerId,payload={version:row.version,resolution:select.value,reason:text.value.trim(),attested:confirmed.checked};resolvePending=stable({caseId:row.id,...payload},resolvePending);busy=true;controls();
   try{await api(`/api/staff/service-cases/${row.id}/resolve`,{method:'POST',body:JSON.stringify({...payload,requestId:resolvePending.requestId})});resolvePending=null;if(destroyed||getContext().customerId!==customerId)return;detailRow=null;detail.replaceChildren(node('p','Resolución guardada. Actualiza el cliente para consultar su saldo actual.'));await refresh();message('Resolución guardada en el historial.');}
   catch(error){if(!destroyed)message(error.message||'No se confirmó la resolución. Puedes reintentar la misma solicitud.');}finally{busy=false;controls();if(detailRow)update();}
  });
 }
 async function openCase(id){
  if(!online()){message('Conéctate para revisar el caso.');return;}const customerId=getContext().customerId,sequence=++detailSequence;
  try{const result=await api(`/api/staff/service-cases/${id}`);if(destroyed||sequence!==detailSequence||customerId!==getContext().customerId)return;renderDetail(result.case,result.restoration);}
  catch(error){if(!destroyed)message(error.message||'No se pudo consultar el caso.');}
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();const context=getContext();if(busy||!online()||!context.customerId)return;const selected=redemptions.find(row=>row.id===redemption.value);
  const payload={customerId:context.customerId,kind:selected?'unfulfilled':'unavailable',reason:reason.value.trim(),...(selected?{redemptionId:selected.id,rewardId:selected.reward_id}:context.rewardId?{rewardId:context.rewardId}:{})};reportPending=stable(payload,reportPending);busy=true;controls();
  try{await api('/api/staff/service-cases',{method:'POST',body:JSON.stringify({...payload,requestId:reportPending.requestId})});if(destroyed||getContext().customerId!==context.customerId)return;reason.value='';reportPending=null;await refresh();message('Incidencia registrada. Puedes revisar el caso.');}
  catch(error){if(!destroyed)message(error.message||'No se confirmó el registro. Puedes reintentar la misma solicitud.');}finally{busy=false;controls();}
 });
 details.addEventListener('toggle',()=>{if(details.open)refresh();});container.querySelector('[data-refresh]').addEventListener('click',()=>{detailSequence++;detailRow=null;updateResolutionControls=null;detail.replaceChildren();refresh();});
 window.addEventListener('offline',contextChanged);window.addEventListener('online',contextChanged);controls();
 return {contextChanged,async showCase(id){details.open=true;await openCase(id);},destroy(){destroyed=true;refreshSequence++;window.removeEventListener('offline',contextChanged);window.removeEventListener('online',contextChanged);container.replaceChildren();}};
}
