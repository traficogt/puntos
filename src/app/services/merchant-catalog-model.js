import { dateTimeSchema } from '../../utils/date-time-schema.js';
import {z} from 'zod';
import {badRequest} from '../../utils/http-error.js';
import {parsePosCsv} from './pos/csv.js';
import {posSourceSchema} from './redemption-pos-model.js';
export const MANUAL_CATALOG_SOURCE='catalog:manual';
export const CSV_CATALOG_SOURCE='catalog:csv';
const text=max=>z.string().min(1).max(max).refine(value=>value===value.trim()&&!/[\p{Cc}\p{Cf}]/u.test(value));
const reference=text(200),uuid=z.guid().transform(value=>value.toLowerCase());
const revision=z.number().int().min(0).max(2147483646);
const item=z.object({productRef:reference,sku:text(100).nullable().optional(),name:text(150),itemKind:z.enum(['product','service']),active:z.boolean()}).strict();
const source=posSourceSchema.refine(value=>![MANUAL_CATALOG_SOURCE,CSV_CATALOG_SOURCE].includes(value));
const observedAt=dateTimeSchema({offset:true}).transform(value=>new Date(value).toISOString());
const uniqueItems=schema=>z.array(schema).min(1).max(200).refine(items=>new Set(items.map(value=>value.productRef)).size===items.length);
const catalogSync=z.object({source,requestId:reference,observedAt,items:uniqueItems(item)}).strict();
const quantity=z.number().finite().min(0).max(1000000000).refine(value=>Math.abs(value*1e6-Math.round(value*1e6))<0.000001).nullable();
const inventory=z.object({source,requestId:reference,branchId:uuid,observedAt,items:uniqueItems(z.object({productRef:reference,availableQuantity:quantity}).strict())}).strict();
const manual=item.extend({requestId:uuid,revision}).strict();
const csvBody=z.object({csv:z.string().max(200*1024)}).strict();
const csvImport=csvBody.extend({requestId:uuid}).strict();
function parse(schema,input){const parsed=schema.safeParse(input);if(!parsed.success)throw badRequest('Revisa las referencias, cantidades, fechas y campos del catálogo.');return parsed.data;}
export const normalizeCatalogSync=input=>parse(catalogSync,input);
export const normalizeInventorySnapshot=input=>parse(inventory,input);
export const normalizeManualCatalogItem=input=>parse(manual,input);
export const normalizeCatalogCsvBody=input=>parse(csvBody,input);
export const normalizeCatalogImport=input=>parse(csvImport,input);
export function normalizeCatalogCsv(csv){
 const {headers,rows}=parsePosCsv(csv,{bytes:200*1024,rows:200});
 const allowed=['productRef','sku','name','itemKind','active','revision'];
 if(!rows.length||headers.some(header=>!allowed.includes(header))||['productRef','name','itemKind'].some(header=>!headers.includes(header)))throw badRequest('Usa productRef, name e itemKind, y opcionalmente sku, active y revision.');
 const items=rows.map(({values})=>{
  const cells=Object.fromEntries(headers.map((header,index)=>[header,values[index].trim()]));
  if(cells.revision!==undefined&&!/^(0|[1-9]\d*)$/.test(cells.revision))throw badRequest('La revisión debe ser un entero no negativo.');
  if(cells.active!==undefined&&!['true','false'].includes(cells.active))throw badRequest('active debe ser true o false.');
  return parse(item.extend({revision}),{productRef:cells.productRef,sku:cells.sku||null,name:cells.name,itemKind:cells.itemKind,active:cells.active!=='false',revision:Number(cells.revision??0)});
 });
 if(new Set(items.map(value=>value.productRef)).size!==items.length)throw badRequest('Cada productRef debe aparecer una sola vez.');
 return items;
}
export const catalogListSchema=z.object({query:z.string().trim().max(100).default(''),source:posSourceSchema.optional(),branchId:uuid.optional(),offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000)),limit:z.string().regex(/^[1-9]\d?$/).default('30').transform(Number).pipe(z.number().int().max(50))}).strict();
