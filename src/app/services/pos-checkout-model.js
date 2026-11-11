import {z} from 'zod';import {createHash} from 'node:crypto';import {badRequest} from '../../utils/http-error.js';import {posSourceSchema} from './redemption-pos-model.js';
const uuid=z.guid().transform(v=>v.toLowerCase()),ref=z.string().trim().min(1).max(200).refine(v=>!/[\u0000-\u001f\u007f]/u.test(v)),base={source:posSourceSchema,branchId:uuid.nullable()},identity={...base,requestId:uuid};
const token=z.string().min(1).max(4096);
const schemas={options:z.object({...base,customerQrToken:token}).strict(),status:z.object(identity).strict(),authorize:z.object({...identity,cartId:ref,cartLineId:ref,customerId:uuid,customerQrToken:token,rewardId:uuid,mappingId:uuid,mappingVersion:z.number().int().positive().max(2147483646),operatorRef:ref}).strict(),cancel:z.object({...identity,cancelRequestId:uuid,cartId:ref,cartLineId:ref,reason:z.string().trim().min(3).max(500),orderState:z.literal('draft'),rewardLineRemoved:z.literal(true)}).strict(),source:z.object({...base,staffId:uuid,enabled:z.boolean(),version:z.number().int().min(0).max(2147483646)}).strict()};
function parse(schema,input){const out=schema.safeParse(input);if(!out.success)throw badRequest('Revisa los datos, la referencia de caja y la confirmación de la solicitud.');return out.data;}
export const normalizeCheckoutOptions=input=>parse(schemas.options,input);
export const normalizeCheckoutAuthorize=input=>parse(schemas.authorize,input);
export const normalizeCheckoutStatus=input=>parse(schemas.status,input);
export const normalizeCheckoutCancel=input=>parse(schemas.cancel,input);
export const normalizeCheckoutSource=input=>parse(schemas.source,input);
export const checkoutFingerprint=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const checkoutIdentityHash=input=>checkoutFingerprint({...input,customerQrToken:checkoutFingerprint(input.customerQrToken)});
