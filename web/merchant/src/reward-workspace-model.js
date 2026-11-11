// Quota belongs to PF redemptions. It is never a physical inventory count.
const nonblank=value=>typeof value==='string'&&value.trim().length>0;
const boundedText=(value,max)=>typeof value==='string'&&value.trim().length<=max&&!/[\p{Cc}\p{Cf}]/u.test(value);
const numeric=value=>value!==null&&value!==undefined&&(typeof value!=='string'||value.trim()!=='')&&Number.isFinite(Number(value));
export function localDateTime(value){
 if(!value)return '';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const pad=n=>String(n).padStart(2,'0');
 return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function rewardDraft(row={}){
 return {id:row.id??null,version:row.version,name:row.name??'',description:row.description??'',originalDescription:row.description??null,points:row.points_cost??'',active:row.active??true,available:row.available??true,unlimited:row.stock==null,quota:row.stock??'',unitCost:row.unit_cost_q??'',validUntil:localDateTime(row.valid_until),originalValidUntil:row.valid_until??null,allBranches:!row.branch_ids?.length,branchIds:row.branch_ids??[],mappingDirty:false,mappingId:null,mappingVersion:0,catalogItem:null,mappingBranchId:'',quantity:'1',inventoryRequired:false,mappingEnabled:true};
}
export function rewardPayload(draft,{minorUnits=2,includeCost=true}={}){
 if(!nonblank(draft.name)||!boundedText(draft.name,150))throw new Error('Escribe un nombre de hasta 150 caracteres.');
 if(typeof draft.description!=='string'||draft.description.length>1000)throw new Error('La descripción admite hasta 1000 caracteres.');
 const points=Number(draft.points);
 if(!numeric(draft.points)||!Number.isSafeInteger(points)||points<1||points>2147483647)throw new Error('Los puntos deben ser un número entero entre 1 y 2 147 483 647.');
 const quota=draft.unlimited?null:Number(draft.quota);
 if(!draft.unlimited&&(!numeric(draft.quota)||!Number.isSafeInteger(quota)||quota<0||quota>2147483647))throw new Error('El límite de canjes debe ser un número entero igual o mayor que cero.');
 const cost=!includeCost||String(draft.unitCost??'').trim()===''?null:Number(draft.unitCost),costScale=10**Math.min(2,minorUnits);
 if(includeCost&&cost!==null&&(!numeric(draft.unitCost)||cost<0||cost>1000000||Math.abs(cost*costScale-Math.round(cost*costScale))>0.00001))throw new Error(minorUnits===0?'Escribe un costo sin decimales para esta moneda, o déjalo vacío si lo desconoces.':'Escribe un costo válido, con hasta dos decimales, o déjalo vacío si lo desconoces.');
 if(!draft.allBranches&&!draft.branchIds.length)throw new Error('Selecciona al menos una sucursal o elige todas.');
 let expiry=null;
 if(draft.validUntil){
  if(draft.validUntil===localDateTime(draft.originalValidUntil))expiry=draft.originalValidUntil;
  else {const parsed=new Date(draft.validUntil);if(!Number.isFinite(parsed.getTime()))throw new Error('Revisa la fecha y hora de vencimiento.');expiry=parsed.toISOString();}
 }
 const result={...(draft.id?{rewardId:draft.id,version:draft.version}:{}),reward:{name:draft.name.trim(),description:draft.description===(draft.originalDescription??'')?draft.originalDescription:draft.description.trim()||null,points_cost:points,active:!!draft.active,stock:quota,valid_until:expiry,branch_ids:draft.allBranches?[]:draft.branchIds},...(includeCost?{unitCostQ:cost}:{}),available:!!draft.available};
 if(draft.mappingDirty){
  if(!draft.catalogItem?.id)throw new Error('Selecciona un artículo del catálogo para guardar el vínculo.');
  const quantity=Number(draft.quantity);
  if(!numeric(draft.quantity)||quantity<=0||quantity>1000000||Math.abs(quantity*1e6-Math.round(quantity*1e6))>0.00001)throw new Error('La cantidad por canje debe ser mayor que cero, con hasta seis decimales.');
  if(draft.inventoryRequired&&draft.catalogItem.itemKind==='service')throw new Error('Un servicio no requiere comprobación de existencias.');
  if(draft.inventoryRequired&&!draft.mappingBranchId)throw new Error('Selecciona una sucursal para comprobar existencias.');
  if(draft.inventoryRequired&&!canCheckInventory(draft.catalogItem,draft.mappingBranchId))throw new Error('La comprobación requiere un producto sincronizado por un conector compatible.');
  if(!draft.allBranches&&draft.mappingBranchId&&!draft.branchIds.includes(draft.mappingBranchId))throw new Error('La sucursal del artículo debe estar incluida en la recompensa.');
  result.mapping={catalogItemId:draft.catalogItem.id,branchId:draft.mappingBranchId||null,quantity,inventoryRequired:!!draft.inventoryRequired,enabled:!!draft.mappingEnabled,...(draft.mappingId?{id:draft.mappingId,version:draft.mappingVersion}:{version:0})};
 }
 return result;
}
export function inventoryDescription(inventory,requiredQuantity=1){
 const state=inventory?.state==='available'&&Number(inventory.quantity)<Number(requiredQuantity)?'unavailable':inventory?.state;
 return ({available:{label:'Existencias suficientes en la última comprobación',color:'teal'},unavailable:{label:'Existencias insuficientes',color:'yellow'},stale:{label:'Comprobación desactualizada',color:'yellow'},not_applicable:{label:'Servicio: no requiere existencias',color:'gray'},not_required:{label:'Comprobación de existencias desactivada',color:'gray'}})[state]??{label:'Sin comprobación reciente de existencias',color:'gray'};
}
export function manualItemPayload(draft){
 if(!nonblank(draft.name)||!boundedText(draft.name,150))throw new Error('Escribe un nombre de artículo de hasta 150 caracteres.');
 if(!boundedText(draft.sku??'',100))throw new Error('El SKU admite hasta 100 caracteres.');
 if(!nonblank(draft.productRef)||!boundedText(draft.productRef,200)||!['product','service'].includes(draft.itemKind))throw new Error('Revisa el tipo y la referencia del artículo.');
 return {productRef:draft.productRef,sku:draft.sku?.trim()||null,name:draft.name.trim(),itemKind:draft.itemKind,active:true,revision:0};
}
export const sourceLabel=item=>item?.origin==='manual'||item?.source==='catalog:manual'?'Registro manual':item?.origin==='csv'||item?.source==='catalog:csv'?'Archivo CSV':item?.source||'Catálogo';

export function rewardStatus(row,now=Date.now()){
 if(!row.active)return {label:'Inactiva',color:'gray'};
 if(row.available===false)return {label:'Entrega pausada',color:'gray'};
 if(row.valid_until&&new Date(row.valid_until).getTime()<=now)return {label:'Vencida',color:'gray'};
 if(row.stock!=null&&Number(row.stock)===0)return {label:'Límite agotado',color:'yellow'};
 return {label:'Activa',color:'teal'};
}
export function catalogPreviewIssues(items){return items.filter(item=>Number(item.revision)!==Number(item.currentRevision)).map(item=>`${item.productRef}: el archivo indica revisión ${item.revision}; la actual es ${item.currentRevision}.`);}

export function canCheckInventory(item,branchId){return !!branchId&&item?.itemKind==='product'&&item.origin==='connector'&&!['catalog:manual','catalog:csv'].includes(item.source);}
