import {merchantRegion} from './region.js';
export const audienceFields=[
 {value:'purchase_count',label:'Compras en el período',kind:'integer'},
 {value:'spend_q',label:'Importe de compras en el período',kind:'money'},
 {value:'last_purchase_days',label:'Días desde la última compra',kind:'integer'},
 {value:'has_purchase',label:'Tiene alguna compra registrada',kind:'boolean'},
 {value:'joined_days',label:'Días desde su registro en PF',kind:'integer'},
 {value:'points_balance',label:'Saldo de puntos disponible',kind:'integer'},
 {value:'marketing_opt_in',label:'Acepta mensajes promocionales',kind:'boolean'}
];
export const emptyAudience=()=>({window_days:90,include:{match:'all',rules:[{field:'purchase_count',operator:'gte',value:2}]},exclude:{match:'any',rules:[]}});
export const audiencePresets={
 frequent:{label:'Clientes frecuentes',definition:()=>({...emptyAudience(),include:{match:'all',rules:[{field:'purchase_count',operator:'gte',value:3}]}})},
 winback:{label:'Sin comprar hace 30 días',definition:()=>({...emptyAudience(),include:{match:'all',rules:[{field:'last_purchase_days',operator:'gte',value:30}]}})},
 new:{label:'Nuevos sin primera compra',definition:()=>({...emptyAudience(),include:{match:'all',rules:[{field:'has_purchase',operator:'eq',value:false},{field:'joined_days',operator:'lte',value:30}]}})},
 value:{label:'Compras por importe mínimo',definition:()=>({...emptyAudience(),include:{match:'all',rules:[{field:'spend_q',operator:'gte',value:500}]}})}
};
export function validateAudience(definition){
 if(![30,90,180,365].includes(definition?.window_days))return 'Selecciona un período válido.';
 for(const [key,min] of [['include',1],['exclude',0]]){
  const group=definition[key];if(!group||!['all','any'].includes(group.match)||!Array.isArray(group.rules)||group.rules.length<min||group.rules.length>8)return 'Usa de una a ocho condiciones para incluir y hasta ocho para excluir.';
  for(const rule of group.rules){if(!rule||typeof rule!=='object'||Array.isArray(rule))return 'Selecciona una condición válida.';const field=audienceFields.find(f=>f.value===rule.field);if(!field)return 'Selecciona un dato disponible.';
   if(field.kind==='boolean'){if(rule.operator!=='eq'||typeof rule.value!=='boolean')return 'Selecciona Sí o No.';}
   else if(!['gte','lte','eq'].includes(rule.operator)||typeof rule.value!=='number'||!Number.isFinite(rule.value)||rule.value<0||rule.value>1000000000||(field.kind==='integer'&&!Number.isInteger(rule.value))||(field.kind==='money'&&Math.abs(rule.value*100-Math.round(rule.value*100))>0.00001))return 'Usa cantidades válidas, enteros para días y puntos, y hasta dos decimales para importes.';
  }
 }return null;
}
export function audienceDescription(definition,region=merchantRegion()){
 const amount=value=>new Intl.NumberFormat(region.locale,{style:'currency',currency:region.currency}).format(value);
 const describe=group=>group.rules.map(r=>`${audienceFields.find(f=>f.value===r.field)?.label||r.field} ${{gte:'≥',lte:'≤',eq:'='}[r.operator]||'?'} ${typeof r.value==='boolean'?(r.value?'Sí':'No'):r.field==='spend_q'?amount(r.value):r.value}`).join(group.match==='all'?' y ':' o ');
 return `${definition.window_days} días · Incluir: ${describe(definition.include)}${definition.exclude.rules.length?` · Excluir: ${describe(definition.exclude)}`:''}`;
}
