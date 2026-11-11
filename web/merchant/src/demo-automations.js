let second={enabled:false,bonus_points:50,minimum_purchase_q:0,duration_days:7,monthly_points_cap:1000,monthly_offer_cap:20};
let brief={enabled:false,weekday:1,hour:9,channel:'email'};
let secondConfigured=false,emailVerified=false,verification=null;const briefHistory=[];const verificationRequests=new Map();
function guided(url,options){
 const suffix=url.pathname.replace('/api/admin/automations',''),body=JSON.parse(options.body||'{}');
 if(suffix==='/second-visit'){
  if(options.method==='PUT'){if(body.enabled&&(body.monthly_points_cap<body.bonus_points||body.monthly_offer_cap<1))throw Error('Revisa el presupuesto de segunda visita.');second={...body};secondConfigured=true;return{ok:true,settings:{...second}};}
  return{settings:{...second},is_configured:secondConfigured,recommendation:{purchase_point_cap:null,settings:{enabled:false,bonus_points:10,minimum_purchase_q:null,duration_days:7,monthly_points_cap:200,monthly_offer_cap:20},source:{reward_id:'demo-reward',reward_name:'Café preparado (ejemplo)',reward_points:100,program_type:'SPEND',earning_rate:0.1,award_guard:null},cost_per_point:null,cost_state:'unknown',estimated_cost:null,maximum_points_commitment:200,missing:['minimum_purchase']},currency:'GTQ',timezone:'America/Guatemala',budget:{points_committed:0,offers_created:0,points_remaining:second.monthly_points_cap},results:{offers_created:0,returned_customers:0,bonuses_claimed:0,open_windows:0},data_readiness:{inactivity_allowed:true},note:'Ejemplo sin envíos ni abonos reales. Las ventanas abiertas pueden cambiar; no demuestra ventas adicionales.'};
 }
 if(suffix==='/owner-brief'){
  if(options.method==='PUT'){if(Object.keys(body).some(key=>!['enabled','weekday','hour','channel'].includes(key))||body.weekday<1||body.weekday>7||body.hour<9||body.hour>17)throw Error('Revisa el horario. El destino es la cuenta de propietario.');if(body.enabled&&!emailVerified)throw Error('Verifica tu correo antes de activar el resumen.');brief={...body,channel:'email'};return{ok:true,settings:{...brief}};}
  return{settings:{...brief},channel:'email',timezone:'America/Guatemala',destination:'propietario@ejemplo.invalid',email_destination:'propietario@ejemplo.invalid',email_verified:emailVerified,destination_ready:emailVerified,recipient_is_current_owner:true,subscription_binding_current:true,email_provider_ready:true,provider_ready:true,verification,history:[...briefHistory]};
 }
 if(suffix==='/owner-brief/email-verification/request'&&options.method==='POST'){
  if(!body.request_id||Object.keys(body).some(k=>k!=='request_id'))throw Error('Solicitud no válida.');
  if(!verificationRequests.has(body.request_id))verificationRequests.set(body.request_id,{request_id:body.request_id,status:'accepted'});
  verification={id:body.request_id,status:'accepted'};return verificationRequests.get(body.request_id);
 }
 if(suffix==='/owner-brief/email-verification/confirm'&&options.method==='POST'){
  if(!verificationRequests.has(body.request_id)||body.token!=='a'.repeat(43))throw Error('Pega 43 letras «a» para verificar en demostración.');
  emailVerified=true;verification=null;return{ok:true,email_verified:true};
 }
 if(suffix==='/owner-brief/test'&&options.method==='POST'){
  if(!emailVerified||!body.request_id||Object.keys(body).some(k=>k!=='request_id'))throw Error('Verifica tu correo y revisa la solicitud.');
  let row=briefHistory.find(r=>r.id===body.request_id);if(!row){row={id:body.request_id,kind:'test',channel:'email',status:'suppressed',attempts:0,reason:'demo_no_send',created_at:new Date().toISOString()};briefHistory.unshift(row);}return{ok:true,id:row.id,status:row.status};
 }
 if(suffix==='/owner-brief/preview'&&options.method==='POST')return{generated_at:'2026-11-11T18:00:00Z',additional_count:1,inbox_href:'#decisiones',findings:[
  {key:'operation-economics',title:'Completa los costos de tus recompensas',text:'Ejemplo: una recompensa activa no tiene costo registrado. Desconocido no significa costo cero; editarlo no cambia los costos históricos.',action:'Completar costos',href:'#costos'},
  {key:'hospitality-unused',title:'Revisa las cortesías que vencieron sin usarse',text:'Ejemplo: 3 de 8 cortesías cuyo plazo terminó en los últimos 30 días vencieron sin entrega registrada. Su compromiso reservado de Q15 no es gasto realizado.',action:'Revisar cortesías',href:'#cortesias'},
  {key:'redemption-follow-up',title:'Revisa las visitas después de canjear',text:'Ejemplo: 12 de 30 clientes con 30 días completos volvieron a comprar. Otros 12 siguen en seguimiento. Se analizan canjes de los últimos 90 días. No demuestra visitas causadas por la recompensa.',action:'Ver seguimiento después del canje',href:'?ver=visitas-tras-canje#resumen'}],note:'Datos ficticios. Esta muestra no se envía. En producción, los enlaces requieren iniciar sesión.'};
 throw Error('Ruta de demostración no disponible.');
}
let settings={birthday_enabled:false,birthday_points:40,birthday_monthly_points_cap:1200,winback_enabled:false,winback_days:30,winback_points:25,winback_monthly_points_cap:1500,minimum_contact_days:7,scheduler_hour_local:9,scheduler_tz:'America/Guatemala'};
export function demoAutomations(url,options={}) {
  if(url.pathname!=='/api/admin/automations')return guided(url,options);
  if(options.method==='PUT'){settings={...JSON.parse(options.body||'{}')};return{ok:true,settings:{...settings}};}
  return{ok:true,settings:{...settings},rules:{birthday:{candidates:4,consented:3,unprocessed:3,points_committed:160,points_remaining:Math.max(0,settings.birthday_monthly_points_cap-160),monthly_awards:4,available_awards:Math.min(3,settings.birthday_points?Math.floor(Math.max(0,settings.birthday_monthly_points_cap-160)/settings.birthday_points):3)},winback:{candidates:18,consented:12,unprocessed:12,points_committed:200,points_remaining:Math.max(0,settings.winback_monthly_points_cap-200),monthly_awards:8,available_awards:Math.min(12,settings.winback_points?Math.floor(Math.max(0,settings.winback_monthly_points_cap-200)/settings.winback_points):12)}},counts:{queued:0,processing:0,accepted:8,failed:1,uncertain:1,suppressed:2},history:[{rule:'birthday',status:'accepted',points:40,reason:null,created_at:'2026-11-10T15:01:00Z'},{rule:'winback',status:'uncertain',points:25,reason:'delivery_uncertain',created_at:'2026-11-09T15:01:00Z'},{rule:'winback',status:'suppressed',points:25,reason:'frequency_cap',created_at:'2026-11-08T15:01:00Z'}],provider_ready:true,date:'2026-11-10',month:'2026-11-01',timezone:'America/Guatemala',delivery_note:'Datos ficticios. Aceptado por el proveedor no significa entregado ni leído. Los puntos se abonan al preparar el incentivo, aunque el mensaje no se entregue.'};
}
