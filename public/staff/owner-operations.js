// Staff access is limited by server assignment and transactionally consumed grants.
export function mountOwnerOperations(container,api){
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
 const button=(text,run)=>{const element=node('button',text);element.type='button';element.className='btn';element.addEventListener('click',run);return element;};
 let pending=false,pendingRequest=null;
 async function mutate(path,body){if(pending)return;pending=true;try{if(body.request_id){const key=JSON.stringify([path,{...body,request_id:undefined}]);if(pendingRequest?.key===key)body.request_id=pendingRequest.id;else pendingRequest={key,id:body.request_id};}await api(path,{method:'POST',body:JSON.stringify(body)});pendingRequest=null;await render();}catch(error){status.textContent=error.message||'No se pudo guardar. Actualiza e intenta de nuevo.';}finally{pending=false;}}
 const status=node('p');status.setAttribute('role','status');
 async function render(){
  container.replaceChildren(node('h2','Pendientes y ritmo del negocio'),status);status.textContent='Consultando autorizaciones…';
  try{
   const [inbox,controls]=await Promise.all([api('/api/staff/decisions'),api('/api/staff/operating-mode')]);status.textContent='';
   if(!inbox.decisions.length)container.append(node('p','No tienes pendientes asignados.'));
   for(const item of inbox.decisions){
    const section=node('section');section.append(node('h3',item.title),node('p',item.explanation),node('p','Costo de la acción: desconocido.'));
    const body=extra=>({decision_key:item.key,fingerprint:item.fingerprint,version:item.review_version,...extra});
    section.append(button('Marcar revisado',()=>mutate('/api/staff/decisions/review',body({status:'reviewed'}))),button('Posponer una hora',()=>mutate('/api/staff/decisions/review',body({status:'snoozed',snooze_hours:1}))),button('Reabrir',()=>mutate('/api/staff/decisions/review',body({status:'open'}))));
    const label=node('label','Motivo para descartar'),reason=node('textarea');reason.maxLength=500;label.append(reason);section.append(label,button('Descartar con motivo',()=>{if(reason.value.trim().length<3){status.textContent='Escribe un motivo de al menos 3 caracteres.';return;}return mutate('/api/staff/decisions/review',body({status:'dismissed',dismiss_reason:reason.value.trim()}));}));container.append(section);
   }
   if(!controls.authorized){container.append(node('p','El dueño aún no te autorizó a cambiar el ritmo o activar ofertas.'),button('Actualizar pendientes y autorizaciones',render));return;}
   container.append(node('h3','Ritmo del negocio'),node('p',`Estado: ${{normal:'normal',quiet:'tranquilo',busy:'ocupado'}[controls.operating_mode.mode]}. Las acciones requieren una autorización vigente del dueño.`));
   if(controls.permissions.operating_mode)for(const [mode,label] of [['quiet','Tranquilo por una hora'],['busy','Ocupado por una hora'],['normal','Volver a normal']])container.append(button(label,()=>mutate('/api/staff/operating-mode',{mode,version:controls.operating_mode.version,request_id:crypto.randomUUID(),...(mode==='normal'?{}:{minutes:60})})));
   container.append(node('h3','Ofertas preaprobadas'));
   for(const template of controls.templates.filter(t=>!t.revoked_at&&t.remaining_runs>0&&new Date(t.expires_at)>new Date())){
    const section=node('section');section.append(node('p',`${template.name}: ${template.terms.points_budget} puntos por activación · ${template.audience_count} participantes guardados · ${template.remaining_runs} activaciones restantes.`),button(`Activar ${template.name}`,()=>mutate('/api/staff/operating-mode/trigger',{template_id:template.id,version:template.version,request_id:crypto.randomUUID()})));container.append(section);
   }
  }catch(error){status.textContent=error.message||'No se pudieron cargar los pendientes.';}
  container.append(button('Actualizar pendientes y autorizaciones',render));
 }
 render();return {refresh:render};
}
