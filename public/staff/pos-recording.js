/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [text] @returns {HTMLElementTagNameMap[K]} */
function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
const labels={pending:'Pendiente en caja',recorded:'Registrado en caja',not_required:'No corresponde',review:'Requiere revisión',reviewed:'Revisado',unknown:'Histórico sin evidencia'};
export function mountPosRecording({container,api,getContext}){
 if(!container)return {contextChanged(){},showRedemption(){},destroy(){}};
 let destroyed=false,generation=0,selected=null,pending=null,busy=false,loaded=null,updateControls=null,scope=null;
 const contextKey=()=>{const c=getContext();return JSON.stringify([c.customerId,c.staffId,c.businessId,c.branchId??null]);};
 const online=()=>navigator.onLine&&getContext().online;
 const current=token=>!destroyed&&token===generation&&scope===contextKey();
 const heading=node('h2','Siguiente paso: registrar en caja'),confirmed=node('p'),instruction=node('p','Registra la recompensa en el POS con su flujo de canje y conserva este código PF en el recibo. Después puedes dejar aquí la comprobación. Las existencias se comprueban en tu caja.'),status=node('p'),body=node('div'),refresh=node('button','Consultar registro de caja');
 heading.tabIndex=-1;instruction.className='small';status.setAttribute('role','status');refresh.type='button';container.hidden=true;
 function controls(){refresh.disabled=busy||!online()||!selected?.redemptionId;updateControls?.();}
 function renderRecord(){
  body.replaceChildren();updateControls=null;
  const record=loaded.fulfillment,state=record?.status??'unknown',redemption=loaded.redemption;
  body.append(node('p',labels[state]??labels.unknown));
  if(state==='unknown')body.append(node('p','El canje no tiene evidencia POS histórica. Comprueba el historial con tu responsable antes de registrar una entrega.'));
  if(record?.receiptRef)body.append(node('p',`Recibo declarado: ${record.receiptRef}`));
  if(record?.method==='manual')body.append(node('p','Declaración del equipo. Las existencias se comprueban en el POS.'));
  if(record?.orderId)body.append(node('p',`Venta POS: ${record.orderId}`));
  if(record?.returnedQuantity>0)body.append(node('p',`Cantidad devuelta: ${record.returnedQuantity}. Se conserva la evidencia original.`));
  if(redemption.points_restored)body.append(node('p','Los puntos de este canje fueron restituidos. Revisa la entrega con tu responsable.'));
  const canRecord=state==='pending'&&!record?.method&&!record?.returnedQuantity&&!redemption.points_restored;
  if(!canRecord){const link=node('a','Resolver una incidencia de entrega');link.href='#staffServiceCases';body.append(link);}
  const form=node('form'),actionLabel=node('label','Comprobación del canje'),action=node('select');action.id='posRecordingAction';actionLabel.htmlFor=action.id;
  if(canRecord)action.add(new Option('Ya se registró en la caja','recorded'));
  action.add(new Option('Necesita revisión','review'));
  const receiptLabel=node('label','Referencia del recibo de caja'),receipt=node('input');receipt.id='posRecordingReceipt';receiptLabel.htmlFor=receipt.id;receipt.maxLength=200;
  const reasonLabel=node('label','Detalle de la comprobación'),reason=node('textarea');reason.id='posRecordingReason';reasonLabel.htmlFor=reason.id;reason.required=true;reason.minLength=3;reason.maxLength=500;reason.rows=3;
  const note=node('p','No incluyas teléfonos, documentos ni datos sensibles.');note.className='small';
  const attested=node('input'),attestLabel=node('label');attested.type='checkbox';attested.id='posRecordingAttestation';attestLabel.htmlFor=attested.id;attestLabel.append(attested,document.createTextNode('Comprobé el recibo y lo descrito.'));
  const save=node('button','Guardar comprobación en PF');save.type='submit';
  function update(){
   const blocked=busy||!online();for(const control of [action,receipt,reason,attested])control.disabled=blocked;
   receiptLabel.hidden=receipt.hidden=action.value!=='recorded';receipt.required=action.value==='recorded';
   save.disabled=blocked||!attested.checked||reason.value.trim().length<3||(action.value==='recorded'&&!receipt.value.trim());
  }
  action.addEventListener('change',()=>{attested.checked=false;update();});receipt.addEventListener('input',update);reason.addEventListener('input',update);attested.addEventListener('change',update);updateControls=update;
  form.append(actionLabel,action,receiptLabel,receipt,reasonLabel,reason,note,attestLabel,save);body.append(form);update();
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(save.disabled||busy||!online()||scope!==contextKey())return;
   const token=generation,redemptionId=selected.redemptionId,payload={version:record?.version??0,action:action.value,...(action.value==='recorded'?{receiptRef:receipt.value.trim()}:{}),reason:reason.value.trim(),attested:true};
   const key=JSON.stringify({redemptionId,...payload});if(pending?.key!==key)pending={key,requestId:crypto.randomUUID()};
   busy=true;controls();status.textContent='Guardando comprobación…';
   try{
    const result=await api(`/api/staff/redemption-pos/${encodeURIComponent(redemptionId)}`,{method:'POST',body:JSON.stringify({...payload,requestId:pending.requestId})});
    if(!current(token))return;if(!result?.fulfillment)throw new Error('No se confirmó el registro. Reintenta con los mismos datos.');
    pending=null;loaded={...loaded,fulfillment:result.fulfillment};renderRecord();status.textContent='Comprobación guardada en PF. Las existencias se verifican en tu caja.';
   }catch(error){if(current(token)){status.textContent=error.message||'No se confirmó la comprobación. Reintenta con los mismos datos.';if([401,403,404,409].includes(error.status)){body.replaceChildren(node('p','Actualiza el registro para comprobar el estado y tu acceso antes de continuar.'));updateControls=null;}}}
   finally{if(current(token)){busy=false;controls();}}
  });
 }
 async function load(){
  if(!selected?.redemptionId||!online()||busy||destroyed)return;
  const token=++generation;busy=true;loaded=null;body.replaceChildren();updateControls=null;controls();status.textContent='Consultando el registro de caja…';
  try{
   const data=await api(`/api/staff/redemption-pos/${encodeURIComponent(selected.redemptionId)}`);
   if(!current(token))return;
   if(!data?.redemption||data.redemption.id!==selected.redemptionId||data.redemption.customer_id!==getContext().customerId)throw new Error('No se pudo verificar este canje para el cliente seleccionado.');
   loaded=data;renderRecord();status.textContent='El canje en PF ya está confirmado. Guarda la comprobación cuando verifiques la caja.';
  }catch(error){if(current(token))status.textContent=error.message||'No pudimos consultar la caja. El canje en PF sigue confirmado. Vuelve a consultar.';}
  finally{if(current(token)){busy=false;controls();}}
 }
 function clear(){generation++;selected=null;pending=null;loaded=null;busy=false;updateControls=null;scope=null;container.replaceChildren();container.hidden=true;}
 function contextChanged(){
  if(destroyed)return;
  if(selected&&scope!==contextKey()){clear();return;}
  if(selected&&!online())status.textContent='Conéctate para comprobar el registro. El canje en PF ya está confirmado; esta comprobación no se guarda sin internet.';
  controls();
 }
 refresh.addEventListener('click',load);window.addEventListener('offline',contextChanged);window.addEventListener('online',contextChanged);
 return {contextChanged,showRedemption(result){
  if(destroyed||!result?.redemptionCode||(result.customerId&&result.customerId!==getContext().customerId)||!getContext().customerId)return;
  clear();scope=contextKey();selected={redemptionId:result.redemptionId,redemptionCode:result.redemptionCode};confirmed.textContent=`Canje confirmado en PF. Código: ${selected.redemptionCode}`;confirmed.className='pos-recording-reference';status.textContent='';container.replaceChildren(heading,confirmed,instruction,refresh,status,body);body.replaceChildren();container.hidden=false;
  heading.focus();
  if(selected.redemptionId)void load();else status.textContent='Conserva el código y el recibo. Tu responsable puede revisar el registro desde Canjes y caja.';
  contextChanged();
 },destroy(){destroyed=true;clear();window.removeEventListener('offline',contextChanged);window.removeEventListener('online',contextChanged);}};
}
