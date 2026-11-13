function node(tag,text,className=''){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
export function createPlatformHealth({container,api,currentSession}){
 if(!container)return {load:async()=>{},clear:()=>{}};
 let offset=0,next=null,serial=0;
 const content=node('div',''),status=node('p','','small');status.setAttribute('role','status');
 const controls=node('div','','row mb-8'),refresh=node('button','Actualizar salud'),previous=node('button','Anteriores'),more=node('button','Siguientes');
 controls.append(refresh,previous,more);container.replaceChildren(node('h2','Salud de los negocios'),node('p','Distingue una conexión incompleta de un negocio con pocas visitas registradas. Los datos del cliente permanecen en su negocio.','small'),controls,status,content);
 function clear(){serial++;offset=0;next=null;content.replaceChildren();status.textContent='';}
 async function load(){const seq=++serial,session=currentSession();refresh.disabled=true;previous.disabled=true;more.disabled=true;status.textContent='Consultando registros operativos…';
  try{const out=await api(`/api/super/operations-health?limit=25&offset=${offset}`);if(seq!==serial||session!==currentSession())return;
   next=out.next_offset;content.replaceChildren();
   for(const b of out.businesses){const section=node('section','','operation-section');section.append(node('h3',b.name),node('p',b.readiness.summary,'small'),node('p',`${b.members} miembros · ${b.recorded_redemptions} canjes registrados · ${b.open_cases} casos abiertos`,'small'));
    if(b.issues.length){const list=node('ul','');for(const issue of b.issues)list.append(node('li',`${issue.summary} ${issue.action}`));section.append(list);}else section.append(node('p','Sin incidencias detectadas en los registros consultados.','small'));
    for(const source of b.readiness.sources??[])section.append(node('p',`${source.label} · ${source.branch_id?`Sucursal: ${source.branch_name??source.branch_id}`:'Todo el negocio'}: ${source.summary}`,'small'));
    section.append(node('p',b.note,'small'));content.append(section);
   }
   status.textContent=out.businesses.length?`Mostrando ${offset+1} a ${offset+out.businesses.length}.`:'No hay negocios en esta página.';
  }catch{if(seq===serial&&session===currentSession()){content.replaceChildren();status.textContent='No se pudo consultar la salud. Vuelve a actualizar.';}}
  finally{if(seq===serial&&session===currentSession()){refresh.disabled=false;previous.disabled=offset===0;more.disabled=next===null;}}
 }
 refresh.addEventListener('click',()=>{offset=0;void load();});previous.addEventListener('click',()=>{offset=Math.max(0,offset-25);void load();});more.addEventListener('click',()=>{if(next!==null){offset=next;void load();}});
 return {load,clear};
}
