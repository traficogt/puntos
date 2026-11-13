import {api} from './lib.js';
const categories={product:'Un producto',reward:'Una recompensa',availability:'Disponibilidad',service:'Un servicio',other:'Otra idea'};
const states={new:'Recibida',reviewing:'En revisión',planned:'Planificada',available:'Disponible',declined:'No prevista'};
/** One mounted form per session; staff links the currently selected member only. */
export function mountDemandNotebook({container,source='customer',getContext=()=>({}),request=api}){
 if(!container||!['staff','customer'].includes(source))return{destroy(){},refresh:async()=>{}};
 if(!document.getElementById('pf-demand-notebook-style')){const link=document.createElement('link');link.id='pf-demand-notebook-style';link.rel='stylesheet';link.href='/styles/demand-notebook.css';document.head.append(link);}
 const prefix=`demand-${crypto.randomUUID()}`,abort=new AbortController();let busy=false,pending=null;
 const make=(tag,text)=>{const element=document.createElement(tag);if(text)element.textContent=text;return element;};
 const section=make('section');section.className='demand-notebook';section.setAttribute('aria-labelledby',`${prefix}-title`);
 const title=make('h2',source==='staff'?'Anotar un pedido':'¿Qué te gustaría encontrar?');title.id=`${prefix}-title`;section.append(title,make('p',source==='staff'?'Registra lo que pidió una persona. Si seleccionaste un cliente, su pedido contará una sola vez por tema.':'Comparte una idea con este negocio. Es un pedido para revisar, sin compromiso de compra ni garantía de disponibilidad.'));
 const form=make('form');const fields={};
 function field(name,label,tag='input'){const wrapper=make('div'),control=make(tag),id=`${prefix}-${name}`;control.id=id;control.name=name;const text=make('label',label);text.htmlFor=id;wrapper.append(text,control);form.append(wrapper);fields[name]=control;return control;}
 const category=field('category','¿Qué estás pidiendo?','select');for(const [value,label]of Object.entries(categories)){const option=make('option',label);option.value=value;category.append(option);}
 const topic=field('topic','Pedido breve');topic.required=true;topic.minLength=3;topic.maxLength=120;topic.placeholder='Por ejemplo, café sin azúcar';
 const reward=field('reward_id','Recompensa relacionada (opcional)','select');const none=make('option','Sin recompensa');none.value='';reward.append(none);
 const context=field('product_context','Producto o contexto (opcional)');context.maxLength=200;
 const note=field('note','Detalle (opcional)','textarea');note.maxLength=1000;note.rows=2;
 const notice=make('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
 const submit=make('button','Guardar pedido');submit.type='submit';submit.className='btn btn-primary';
 const reload=make('button','Actualizar pedidos');reload.type='button';reload.className='btn btn-secondary';
 const history=make('div');form.append(submit);section.append(form,notice,reload,history);container.append(section);
 async function refresh(){
  try{const data=await request(`/api/${source}/demand-notebook`,{cache:'no-store',signal:abort.signal});if(abort.signal.aborted)return;
   reward.replaceChildren(none);for(const row of data.rewards??[]){const option=make('option',row.name);option.value=row.id;reward.append(option);}const selected=getContext();if(selected.rewardId)reward.value=selected.rewardId;
   history.replaceChildren();if(source==='customer'&&data.requests?.length){history.append(make('h3','Tus pedidos'));const list=make('ul');for(const row of data.requests){const item=make('li',`${row.topic} · ${states[row.status]??row.status}`);list.append(item);}history.append(list);}
  }catch(error){if(error.name!=='AbortError')notice.textContent=error.message||'No pudimos cargar los pedidos. Actualiza para intentar otra vez.';}
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  const selected=getContext(),body={category:category.value,topic:topic.value.trim(),note:note.value.trim(),reward_id:reward.value||null,product_context:context.value.trim()||null,...(source==='staff'?{customer_id:selected.customerId??null}:{})},key=JSON.stringify(body);
  if(pending?.key!==key)pending={key,body:{...body,request_id:crypto.randomUUID()}};
  busy=true;submit.disabled=true;notice.textContent='Guardando pedido…';
  try{const result=await request(`/api/${source}/demand-notebook`,{method:'POST',body:JSON.stringify(pending.body),signal:abort.signal});if(abort.signal.aborted)return;pending=null;form.reset();await refresh();notice.textContent=result.deduplicated?'Este cliente ya tiene un pedido de este tema. Se conserva un solo registro.':'Pedido guardado. El negocio podrá revisarlo.';}catch(error){if(error.name!=='AbortError')notice.textContent=error.message||'No pudimos guardar. Reintenta con conexión.';}finally{busy=false;submit.disabled=false;}
 },{signal:abort.signal});
 reload.addEventListener('click',refresh,{signal:abort.signal});refresh();
 return{refresh,destroy(){abort.abort();section.remove();}};
}
