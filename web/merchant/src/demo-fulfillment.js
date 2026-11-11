import {manualPayload,mappingPayload} from './fulfillment-model.js';
// Fictional session state only. This module never calls the network or a POS.
const at='2026-11-11T15:00:00.000Z';
const uuid=n=>`f1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rewards=[{id:uuid(101),name:'Café de la casa',active:true},{id:uuid(102),name:'Postre del día',active:true}];
const branches=[{id:uuid(201),name:'Local central'},{id:uuid(202),name:'Sucursal norte'}];
const rows=Array.from({length:57},(_,i)=>{
 const pos_status=['pending','recorded','review','not_required','unknown'][i%5];
 return {id:uuid(i+1),customer_id:uuid(301+i),reward_id:rewards[i%2].id,branch_id:branches[i%2].id,branch_name:branches[i%2].name,code:(0xA1000000+i).toString(16).toUpperCase(),points_cost:i%2?75:50,created_at:new Date(Date.parse(at)-i*3600000).toISOString(),reward_name:rewards[i%2].name,pos_status,version:['pending','unknown'].includes(pos_status)?0:1,method:['pending','unknown'].includes(pos_status)?null:i%2?'manual':'connector',source:pos_status==='recorded'?'Caja de ejemplo':null,order_id:pos_status==='recorded'?`EJ-${i+1}`:null,line_id:pos_status==='recorded'?`LINEA-${i+1}`:null,stock_status:pos_status==='review'?'returned':'unknown',receipt_ref:pos_status==='recorded'?`EJ-${i+1}`:null,recorded_at:pos_status==='recorded'?at:null,returned_quantity:pos_status==='review'?1:0,points_restored:pos_status==='review'&&i%2===0};
});
const mappings=[],requests=new Map(),events=new Map(rows.map(row=>[row.id,[]]));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const publicRecord=row=>row.pos_status==='unknown'?null:{redemptionId:row.id,status:row.pos_status,version:row.version,method:row.method,source:row.source,orderId:row.order_id,lineId:row.line_id,stockStatus:row.stock_status,receiptRef:row.receipt_ref,recordedAt:row.recorded_at,returnedQuantity:row.returned_quantity,mapping:null};
export function demoFulfillment(url,options={}) {
 const base='/api/admin/redemption-pos',mappingBase='/api/admin/reward-pos-mappings',method=options.method??'GET';
 if(url.pathname===mappingBase&&method==='GET')return structuredClone({ok:true,rewards,branches,mappings});
 if(url.pathname.startsWith(`${mappingBase}/`)&&method==='PUT'){
  const rewardId=url.pathname.slice(mappingBase.length+1),value=mappingPayload(JSON.parse(options.body??'{}'));
  if(!rewards.some(r=>r.id===rewardId))fail('Recompensa de ejemplo no encontrada.',404);
  if(value.branchId&&!branches.some(b=>b.id===value.branchId))fail('Selecciona una sucursal de este negocio.');
  let old=mappings.find(m=>m.reward_id===rewardId&&m.source===value.source);
  if((old?.version??0)!==value.version)fail('El vínculo cambió. Actualiza antes de guardar.',409);
  const saved={id:old?.id??uuid(501+mappings.length),reward_id:rewardId,source:value.source,branch_id:value.branchId,product_ref:value.productRef,item_name:value.itemName,item_kind:value.itemKind,quantity:value.quantity,enabled:value.enabled,version:value.version+1};
  if(old)Object.assign(old,saved);else mappings.push(saved);
  return structuredClone({ok:true,mapping:saved});
 }
 if(url.pathname===base&&method==='GET'){
  const status=url.searchParams.get('status')??'pending',code=(url.searchParams.get('code')??'').toUpperCase(),offset=Number(url.searchParams.get('offset')??0);
  if(!['all','pending','recorded','review','reviewed','not_required','unknown'].includes(status)||!(/^[A-F0-9]{0,16}$/).test(code)||!Number.isInteger(offset)||offset<0||offset>100000)fail('Filtro de canjes inválido.');
  const filtered=rows.filter(row=>(status==='all'||row.pos_status===status)&&row.code.startsWith(code));
  return structuredClone({ok:true,records:filtered.slice(offset,offset+50),summary:rows.reduce((s,row)=>({...s,[row.pos_status]:(s[row.pos_status]??0)+1}),{}),pagination:{offset,limit:50,has_more:offset+50<filtered.length}});
 }
 if(url.pathname.startsWith(`${base}/`)){
  const row=rows.find(item=>item.id===url.pathname.slice(base.length+1));
  if(!row)fail('Canje de ejemplo no encontrado.',404);
  if(method==='GET')return structuredClone({ok:true,redemption:{id:row.id,code:row.code,reward_name:row.reward_name,customer_id:row.customer_id,branch_id:row.branch_id,points_restored:row.points_restored},fulfillment:publicRecord(row),events:events.get(row.id)});
  if(method==='POST'){
   const input=JSON.parse(options.body??'{}'),value=manualPayload(input),key=JSON.stringify({id:row.id,...input});
   if(!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).test(input.requestId??''))fail('Referencia de solicitud inválida.');
   if(requests.has(input.requestId)){if(requests.get(input.requestId)!==key)fail('La solicitud ya corresponde a otro registro.',409);return structuredClone({ok:true,fulfillment:publicRecord(row),replay:true});}
   if(row.version!==value.version)fail('El canje cambió. Actualiza antes de registrar evidencia.',409);
   if(value.action==='reviewed'&&row.pos_status!=='review')fail('Solo se pueden cerrar canjes en revisión.',409);
   if(!['review','reviewed'].includes(value.action)&&(row.pos_status!=='pending'||row.method||row.returned_quantity||row.points_restored))fail('Este canje requiere revisión; conserva su historial.',409);
   row.pos_status=value.action;row.method??='manual';row.receipt_ref??=value.receiptRef??null;row.version++;
   if(value.action==='recorded')row.recorded_at=at;
   events.get(row.id).push({event_id:input.requestId,source:'manual',kind:value.action,created_at:at,details:{reason:value.reason,receiptRef:value.receiptRef??null,attested:true,evidence:'staff_reported'}});
   requests.set(input.requestId,key);
   return structuredClone({ok:true,fulfillment:publicRecord(row),replay:false});
  }
 }
 fail('Acción no disponible en esta demostración.',404);
}
