export const fulfillmentLabels = {
 pending: 'Pendiente en caja', recorded: 'Registrado en caja', review: 'Requiere revisión',
 reviewed: 'Revisado', not_required: 'No corresponde', unknown: 'Histórico sin evidencia',
};
export const actionLabels = {recorded:'Confirmar registro en caja',not_required:'No corresponde un registro en caja',review:'Enviar a revisión',reviewed:'Cerrar revisión'};
export function fulfillmentState(record) {
 const status = record?.status ?? record?.pos_status ?? 'unknown';
 return {status: Object.hasOwn(fulfillmentLabels,status)?status:'unknown',version:record?.version??0};
}
export function fulfillmentActions(detail) {
 const row=detail?.fulfillment;
 if(row?.status==='review')return ['reviewed','review'];
 return row?.status==='pending'&&!row.method&&!row.returnedQuantity&&!detail?.redemption?.points_restored
  ? ['recorded','not_required','review'] : ['review'];
}
export function stockDescription(row) {
 if(row?.method==='manual')return 'Registro declarado por el equipo. Las existencias se comprueban en la caja.';
 const labels={done:'El conector informó el movimiento de existencias.',pending:'Movimiento de existencias pendiente según el conector.',not_applicable:'El conector indicó que no corresponde un movimiento de existencias.',returned:'El conector informó una devolución de existencias.'};
 return labels[row?.stockStatus??row?.stock_status]??'Sin confirmación de existencias del POS.';
}
const text=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
export function manualPayload(value) {
 if(!Object.hasOwn(actionLabels,value.action)||!Number.isInteger(value.version)||value.version<0||value.attested!==true||typeof value.reason!=='string'||value.reason.trim().length<3||value.reason.trim().length>500||
  (value.action==='recorded'&&!text(value.receiptRef,1,200)))throw new Error('Agrega el recibo, el motivo y tu confirmación antes de guardar.');
 return {version:value.version,action:value.action,...(value.action==='recorded'?{receiptRef:value.receiptRef.trim()}:{}),reason:value.reason.trim(),attested:true};
}
export function stableRequest(payload,previous,makeId=()=>crypto.randomUUID()) {
 const key=JSON.stringify(payload);
 return previous?.key===key?previous:{key,requestId:makeId()};
}
export function mappingPayload(value) {
 const quantity=Number(value.quantity);
 if(!text(value.source,1,180)||!(/^[\p{L}\p{N} ._:-]+$/u).test(value.source.trim())||!text(value.productRef,1,200)||!text(value.itemName,1,150)||!['product','service'].includes(value.itemKind)||!Number.isFinite(quantity)||quantity<=0||quantity>1000000||Math.abs(quantity*1e6-Math.round(quantity*1e6))>=0.00001||!Number.isInteger(value.version)||value.version<0||typeof value.enabled!=='boolean')throw new Error('Revisa el origen, la referencia del artículo y la cantidad (hasta seis decimales).');
 return {source:value.source.trim(),branchId:value.branchId||null,productRef:value.productRef.trim(),itemName:value.itemName.trim(),itemKind:value.itemKind,quantity,enabled:value.enabled,version:value.version};
}
