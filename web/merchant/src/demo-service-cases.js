// Fictional session state. This module performs no network or customer actions.
const at='2026-11-11T15:00:00.000Z';
const cases=[
 {id:'sample-service-coffee',customer_id:'25ac4bc2-60d5-49e7-8919-40aa7570d819',customer_display_name:'Lucía (ejemplo)',branch_display_name:'Local central',reporting_staff_display_name:'Ana (ejemplo)',reward_id:'sample-coffee',redemption_id:'sample-redemption',branch_id:null,kind:'unfulfilled',status:'open',version:1,reason:'El café no se entregó después del canje.',evidence:{promise_terms:null,reward_name_at_report:'Café de la casa',redemption:{points_cost:50,status:'REDEEMED'},physical_fulfillment:'unverified',points_deducted:null},created_at:at,resolution:null},
 {id:'sample-service-dessert',customer_id:'7fd84fbf-2013-422c-8db7-c1d7344d30c7',customer_display_name:'Mateo (ejemplo)',branch_display_name:'Local central',reporting_staff_display_name:'Ana (ejemplo)',reward_id:'sample-dessert',redemption_id:null,branch_id:null,kind:'redemption_failed',status:'open',version:1,reason:'La recompensa no tenía existencias al intentar el canje.',evidence:{promise_terms:null,reward_name_at_report:'Postre del día',redemption:null,physical_fulfillment:'unverified',points_deducted:false},created_at:at,resolution:null}
];
const events=new Map(cases.map(row=>[row.id,[{id:`reported-${row.id}`,event_type:'reported',version:1,created_at:at,details:{reason:row.reason}}]]));
const requests=new Map();
export function demoServiceCases(url,options={}){
 const base='/api/admin/service-cases',method=options.method??'GET',suffix=url.pathname.slice(base.length);
 if(!suffix&&method==='GET'){const status=url.searchParams.get('status')??'open',offset=Number(url.searchParams.get('offset')??0);const rows=cases.filter(row=>status==='all'||row.status===status);return structuredClone({ok:true,cases:rows.slice(offset,offset+50),pagination:{offset,limit:50,has_more:offset+50<rows.length}});}
 const [id,action]=suffix.replace(/^\//,'').split('/'),row=cases.find(item=>item.id===id);if(!row)throw new Error('Caso de ejemplo no encontrado.');
 if(method==='GET'&&!action)return structuredClone({ok:true,case:row,events:events.get(id),restoration:row.resolution==='points_restored'?{points_restored:50}:null});
 if(method==='POST'&&action==='resolve'){
  const body=JSON.parse(options.body??'{}'),key=JSON.stringify({id,...body}),previous=requests.get(body.requestId);
  if(previous){if(previous!==key)throw new Error('La referencia ya se usó.');return structuredClone({ok:true,case:row,replay:true});}
  if(row.status!=='open'||row.version!==body.version)throw new Error('El caso cambió; actualiza antes de resolverlo.');
  if(!['original_fulfilled','alternative_accepted','closed_with_reason','points_restored'].includes(body.resolution)||String(body.reason??'').trim().length<3)throw new Error('Describe la resolución.');
  if(['original_fulfilled','alternative_accepted'].includes(body.resolution)&&body.attested!==true)throw new Error('Confirma lo acordado con el cliente.');
  if(body.resolution==='points_restored'&&!row.redemption_id)throw new Error('Este caso no tiene un canje completado.');
  row.status='resolved';row.resolution=body.resolution;row.version+=1;row.resolved_at=at;
  events.get(id).push({id:`resolved-${id}`,event_type:'resolved',version:row.version,created_at:at,details:{resolution:body.resolution,reason:body.reason,attested:body.attested===true,restoration:body.resolution==='points_restored'?{points_restored:50}:null}});requests.set(body.requestId,key);
  return structuredClone({ok:true,case:row,replay:false});
 }
 throw new Error('Acción no disponible en la demostración.');
}
