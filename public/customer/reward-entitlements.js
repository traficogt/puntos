import {setHidden} from '/lib.js';
import {formatNumber,formatPoints,missingPointsText} from './format.js';
import {isCustomerAuthError} from './session.js';
export function clearRewardEntitlements($){$('#rewardEntitlements')?.replaceChildren();setHidden($('#rewardEntitlementsSection'),true);}
/** Replaces the displayed benefits only when this load's answer arrives. */
export async function loadRewardEntitlements({api,$,isCurrent}){
 const list=$('#rewardEntitlements');if(!list)return;
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
 const rows=[];
 try{const data=await api('/api/customer/reward-entitlements',{cache:'no-store'});if(!isCurrent())return;if(!navigator.onLine)return clearRewardEntitlements($);
  const region=data.region;
  const when=value=>new Intl.DateTimeFormat(region?.locale||'es-GT',{dateStyle:'medium',timeStyle:'short',timeZone:region?.timezone||'America/Guatemala'}).format(new Date(value));
  if(data.cycle){const cycle=data.cycle,rate=cycle.program_type==='SPEND'?cycle.earning_terms.points_per_q:cycle.program_type==='VISIT'?cycle.earning_terms.points_per_visit:cycle.earning_terms.points_per_item,unit=cycle.program_type==='SPEND'?`por ${region?.currency||'unidad de compra'}`:cycle.program_type==='VISIT'?'por visita':'por artículo';rows.push(node('p',`Tu ciclo conserva ${formatNumber(rate,region,{maximumFractionDigits:20})} ${Math.abs(Number(rate))===1?'punto':'puntos'} ${unit} y estas opciones hasta tu primer canje con puntos. Se registró el ${when(cycle.observed_at)}. Después usarás la regla vigente.`));
   for(const promise of data.promises){const row=node('div','');row.className='cus-activity-pane';const deadline=promise.effective_valid_until??promise.valid_until,expired=deadline&&new Date(deadline)<=new Date(data.server_now),ready=Number(data.points)>=promise.points_cost,unavailable=!promise.available||promise.stock===0,missing=Math.max(0,promise.points_cost-data.points);row.append(node('h3',promise.reward_name),node('p',`${formatPoints(promise.points_cost,region)} · ${expired?'Vigencia vencida':unavailable?'Entrega temporalmente no disponible':ready?'Tienes los puntos necesarios; confirma en caja la disponibilidad y las condiciones del canje':`${missingPointsText(missing,region)} ${missing===1?'disponible':'disponibles'}`}.`));if(promise.description)row.append(node('p',promise.description));if(promise.valid_until)row.append(node('p',`Plazo original: ${when(promise.valid_until)}.`));if(promise.effective_valid_until&&promise.effective_valid_until!==promise.valid_until)row.append(node('p',`Extensión aprobada: vigente hasta ${when(promise.effective_valid_until)}.`));if(promise.branch_ids.length)row.append(node('p','Válido en las sucursales del beneficio original. Confirma en caja.'));if(promise.alternatives?.length)row.append(node('p',`Alternativas aprobadas: ${promise.alternatives.map(x=>x.name).join(', ')}. Tú decides si aceptas; consulta existencias en caja.`));rows.push(row);}
  }
  const current=data.hospitality.filter(row=>!row.redemption_id&&new Date(row.expires_at)>new Date(data.server_now));
  for(const benefit of current){const row=node('div','');row.className='cus-activity-pane';row.append(node('h3',benefit.title),node('p',`${benefit.reward_name} · Sin descontar puntos. Una unidad hasta ${when(benefit.expires_at)}.`),node('p',!benefit.available||benefit.stock===0?'Entrega temporalmente no disponible. Consulta al equipo; tu beneficio sigue registrado.':'Muestra tu tarjeta al equipo para recibirlo.'));if(benefit.branch_id)row.append(node('p','Válido en la sucursal donde se emitió.'));rows.push(row);}
  list.replaceChildren(...rows);
  setHidden($('#rewardEntitlementsSection'),!data.cycle&&!current.length);
 }catch(error){if(!isCurrent())return;if(isCustomerAuthError(error))throw error;if(!navigator.onLine)return clearRewardEntitlements($);list.replaceChildren(node('p','No pudimos consultar tus beneficios protegidos. Actualiza la tarjeta con conexión.'));setHidden($('#rewardEntitlementsSection'),false);}
}
