import {createHash} from 'node:crypto';
import {badRequest,conflict} from '../../utils/http-error.js';
export const DEMAND_CATEGORIES=['product','reward','availability','service','other'];
export const DEMAND_STATUSES=['new','reviewing','planned','available','declined'];
export const CLAIM_TRANSITIONS={draft:['submitted','rejected'],submitted:['approved','rejected'],approved:['paid','rejected'],rejected:['submitted'],paid:[]};
export function demandText(value,min=0,max=1000){const text=typeof value==='string'?value.trim():'';if(text.length<min||text.length>max)throw badRequest(`Escribe entre ${min} y ${max} caracteres.`);return text;}
export function normalizeDemand(input){
 const category=input.category,topic=demandText(input.topic,3,120).replace(/\s+/g,' '),note=demandText(input.note),productContext=demandText(input.productContext,0,200)||null,rewardId=input.rewardId??null;
 if(!DEMAND_CATEGORIES.includes(category))throw badRequest('Selecciona una categoría válida.');
 const normalized=value=>(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
 const topicKey=createHash('sha256').update(JSON.stringify([category,normalized(topic),rewardId,normalized(productContext)])).digest('hex');
 return{category,topic,note,productContext,rewardId,topicKey};
}
export function validateClaimTransition(row,input){
 if(!CLAIM_TRANSITIONS[row.status]?.includes(input.status))throw conflict('La transición no corresponde al estado actual de la reclamación.');
 const reference=demandText(input.reference,3,200);
 if(input.status==='paid'){
  if(!Number.isSafeInteger(input.paid_minor)||input.paid_minor!==Number(row.amount_minor))throw badRequest('El importe recibido debe coincidir con el aprobado. Registra la diferencia con el proveedor antes de conciliar.');
  if(typeof input.paid_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.paid_at)||new Date(`${input.paid_at}T00:00:00Z`).toISOString().slice(0,10)!==input.paid_at||input.paid_at>new Date().toISOString().slice(0,10))throw badRequest('Registra una fecha real de pago, sin fechas futuras.');
 }
 return{status:input.status,reference,paid_minor:input.status==='paid'?input.paid_minor:null,paid_at:input.status==='paid'?input.paid_at:null};
}
export function supplierExport(rows){
 const columns=['claim_id','supplier','agreement','reward','fulfilled_at','evidence_kind','amount_minor','currency','status','paid_minor','paid_at'];
 const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
 return [columns,...rows.map(r=>[r.id,r.supplier_name,r.agreement_title,r.reward_name??r.evidence?.reward_name,r.fulfilled_at??r.evidence?.fulfilled_at,r.evidence?.kind,r.amount_minor,r.currency,r.status,r.paid_minor,r.paid_at instanceof Date?r.paid_at.toISOString().slice(0,10):r.paid_at])].map(row=>row.map(cell).join(',')).join('\r\n');
}
