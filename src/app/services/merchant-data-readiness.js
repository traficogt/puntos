const HOUR=3600000;
const summaries={
 integration_paused:'La importación automática está pausada. No podemos interpretar la ausencia de compras como inactividad.',
 initial_sync_incomplete:'Todavía no hay una ventana de importación automática completada.',
 sync_stale:'La importación automática lleva más de 24 horas sin completar una ventana.',
 sync_incomplete:'Hay una ventana de importación incompleta.',
 sync_errors:'La última importación registra errores pendientes de revisar.',
 pending_receipts:'Hay ventas pendientes de incorporar.',
 sync_time_invalid:'La fecha de importación no permite comprobar la vigencia de los datos.'
};
function stamp(value){if(typeof value!=='string'&&!(value instanceof Date))return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}
export function readinessForBusiness(business={},now=new Date()) {
 const pos=business.program_json?.pos_integration??{},sync=pos.last_sync??{};
 const source=['loyverse','csv','api'].includes(pos.mode)?pos.mode:'manual';
 const automatic=source==='loyverse'&&pos.automatic===true;
 const completed=stamp(pos.last_completed_at);
 let reason=null;
 if(automatic&&pos.enabled!==true)reason='integration_paused';
 else if(pos.enabled===true||automatic){
  if(Array.isArray(pos.pending_receipts)&&pos.pending_receipts.length||Number(sync.pending)>0)reason='pending_receipts';
  else if(Number(sync.errors)>0||['error','attention'].includes(sync.status))reason='sync_errors';
  else if(sync.has_more===true)reason='sync_incomplete';
  else if(automatic&&!completed)reason='initial_sync_incomplete';
  else if(automatic&&Date.parse(completed)>now.getTime()+5*60000)reason='sync_time_invalid';
  else if(automatic&&now.getTime()-Date.parse(completed)>24*HOUR)reason='sync_stale';
 }
 const state=reason?'blocked':automatic?'ready':'recorded_only';
 return{state,source,inactivity_allowed:!reason,reason,last_completed_at:completed,checked_at:now.toISOString(),
  summary:reason?summaries[reason]:automatic?'La última ventana de importación está completa y dentro de 24 horas. Esto no acredita todas las ventas del negocio.':'El análisis usa únicamente las compras registradas en PF. Este método no tiene un plazo automático de sincronización.',
  action:{label:'Revisar conexión de caja',href:'#conectar-caja'}};
}
export function campaignNeedsFreshActivity(campaign={}) {
 if(campaign.recovery_run_id)return true;
 const definition=campaign.audience_snapshot?.definition;
 return ['include','exclude'].some(group=>Array.isArray(definition?.[group]?.rules)&&definition[group].rules.some(rule=>['last_purchase_days','has_purchase','purchase_count','spend_q'].includes(rule.field)));
}
/** @param {{business?:any,campaign?:any,rule?:string,now?:Date}} options */
export function promotionDelay({business={},campaign=null,rule=null,now=new Date()}) {
 const mode=business.program_json?.merchant_operating_mode,until=stamp(mode?.until);
 if(mode?.mode==='busy'&&until&&Date.parse(until)>now.getTime())return{reason:'business_busy',until};
 const quality=readinessForBusiness(business,now);
 if(!quality.inactivity_allowed&&(rule==='winback'||campaign&&campaignNeedsFreshActivity(campaign)))return{reason:`data_quality_${quality.reason}`,until:new Date(now.getTime()+HOUR).toISOString()};
 return null;
}
