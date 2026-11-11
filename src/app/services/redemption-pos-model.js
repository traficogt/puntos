import {createHash} from 'node:crypto';
import {z} from 'zod';
import {badRequest} from '../../utils/http-error.js';
import {REGIONAL_CURRENCY_CODES} from '../../../public/regional-catalog.js';
const uuid=z.guid().transform(v=>v.toLowerCase());
const reference=z.string().trim().min(1).max(200).refine(v=>!/[\u0000-\u001f\u007f]/u.test(v));
export const posSourceSchema=z.string().trim().min(1).max(180).regex(/^[\p{L}\p{N} ._:-]+$/u).refine(v=>!['manual','system'].includes(v));
const quantity=z.number().finite().positive().max(1000000).refine(v=>Math.abs(v*1e6-Math.round(v*1e6))<0.00001);
const mapping=z.object({source:posSourceSchema,branchId:uuid.nullable(),productRef:reference,itemName:z.string().trim().min(1).max(150),itemKind:z.enum(['product','service']),quantity,enabled:z.boolean(),inventoryRequired:z.boolean().optional(),version:z.number().int().min(0).max(2147483646)}).strict();
const event=z.object({eventId:reference,redemptionId:uuid,source:posSourceSchema,orderId:reference,lineId:reference,productRef:reference,quantity,currency:z.string().refine(v=>REGIONAL_CURRENCY_CODES.includes(v)),mappingId:uuid,mappingVersion:z.number().int().min(1).max(2147483646),kind:z.enum(['recorded','reversed','stock_updated']),stockStatus:z.enum(['unknown','pending','done','not_applicable','returned']),lineTotal:z.literal(0),checkoutRequestId:uuid.optional(),cartId:reference.optional(),cartLineId:reference.optional(),originalEventId:reference.optional()}).strict().superRefine((v,ctx)=>{
 if([v.checkoutRequestId,v.cartId,v.cartLineId].filter(x=>x!==undefined).length%3!==0)ctx.addIssue({code:'custom',message:'Falta la identidad completa del carrito.'});
 if(v.kind==='recorded'&&(v.originalEventId!==undefined||v.stockStatus==='returned'))ctx.addIssue({code:'custom',message:'Registro inicial inválido.'});
 if(v.kind!=='recorded'&&(!v.originalEventId||v.originalEventId===v.eventId))ctx.addIssue({code:'custom',message:'Falta referencia al evento original.'});
 if(v.kind==='reversed'&&v.stockStatus==='done')ctx.addIssue({code:'custom',message:'Indica el estado de la devolución.'});
});
const manual=z.object({requestId:uuid,version:z.number().int().min(0).max(2147483646),action:z.enum(['recorded','not_required','review','reviewed']),receiptRef:reference.optional(),reason:z.string().trim().min(3).max(500),attested:z.literal(true)}).strict().refine(v=>v.action!=='recorded'||Boolean(v.receiptRef));
function parse(schema,input,message){const out=schema.safeParse(input);if(!out.success)throw badRequest(message);return out.data;}
export const normalizeRewardPosMapping=input=>parse(mapping,input,'Revisa el origen, producto o servicio, sucursal, cantidad y versión del vínculo.');
export const normalizePosFulfillmentEvent=input=>parse(event,input,'Revisa la identidad del canje, recibo, artículo, cantidad, moneda y evento original.');
export const normalizeManualFulfillment=input=>parse(manual,input,'Confirma el registro real y agrega una referencia y un motivo válidos.');
export const normalizePosLookup=input=>parse(z.object({source:posSourceSchema,code:z.string().trim().toUpperCase().regex(/^(?:[A-F0-9]{8}|[A-F0-9]{16})$/)}).strict(),input,'Indica el origen y el código de canje PF.');
export const normalizeMappingLookup=input=>parse(z.object({source:posSourceSchema}).strict(),input,'Indica el origen de esta caja.');
export const fulfillmentFingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
