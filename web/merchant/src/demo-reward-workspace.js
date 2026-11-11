import {parsePosCsv} from '../../../src/app/services/pos/csv.js';
import {canCheckInventory,manualItemPayload,rewardDraft,rewardPayload} from './reward-workspace-model.js';
// Fictional page-session state. No network, POS, persistence or real customers.
const uuid=n=>`fa000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let next=1000;
const branches=[{id:uuid(201),name:'Local central'},{id:uuid(202),name:'Sucursal norte'}];
const region={country:'GT',currency:'GTQ',locale:'es-GT',timezone:'America/Guatemala',minorUnits:2};
const features={analytics:true,rewards:true,external_awards:true,redemptions:true};
const items=[{id:uuid(301),source:'Caja de ejemplo',productRef:'CAFE-01',sku:'C-01',name:'Café de la casa',itemKind:'product',active:true,origin:'connector',revision:1,observedAt:'2026-11-11T15:00:00.000Z'},{id:uuid(302),source:'catalog:manual',productRef:'SERV-01',sku:null,name:'Sesión de asesoría',itemKind:'service',active:true,origin:'manual',revision:1,observedAt:null}];
const rewards=[{id:uuid(101),name:'Café de la casa',description:'Una taza de nuestro café del día.',points_cost:50,stock:null,valid_until:null,branch_ids:[],active:true,available:true,unit_cost_q:4.5,version:'demo-1',mappings:[]},{id:uuid(102),name:'Postre del día',description:'Consulta el postre disponible con el equipo.',points_cost:80,stock:20,valid_until:null,branch_ids:[branches[0].id],active:true,available:false,unit_cost_q:null,version:'demo-1',mappings:[]}];
const sources=[],staff=[{id:uuid(401),name:'Ana de ejemplo',role:'CASHIER',branch_id:branches[0].id,active:true},{id:uuid(402),name:'Luis de ejemplo',role:'MANAGER',branch_id:branches[1].id,active:true}],requests=new Map();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const copy=value=>structuredClone(value);
function replay(body,path){if(!/^[a-f0-9-]{36}$/i.test(body.requestId??''))fail('Referencia de solicitud inválida.');const previous=requests.get(body.requestId),key=JSON.stringify({path,body});if(previous){if(previous.key!==key)fail('La solicitud ya corresponde a otros datos.',409);return {...copy(previous.result),replay:true};}return null;}
function remember(body,path,result){requests.set(body.requestId,{key:JSON.stringify({path,body}),result:copy(result)});return result;}
function inventory(item,branchId){return item.itemKind==='service'?{state:'not_applicable',quantity:null,observedAt:null}:item.origin==='connector'&&branchId?{state:'stale',quantity:12,observedAt:item.observedAt}:{state:'unknown',quantity:null,observedAt:null};}
function previewCsv(csv){
 const parsed=parsePosCsv(csv,{rows:200,bytes:200*1024});
 for(const field of ['productRef','name','itemKind'])if(!parsed.headers.includes(field))fail(`Falta la columna ${field}.`);
 if(parsed.headers.some(header=>!['productRef','sku','name','itemKind','active','revision'].includes(header)))fail('El archivo contiene columnas no admitidas.');
 if(!parsed.rows.length)fail('Incluye al menos un artículo en el CSV.');
 const seen=new Set();
 return parsed.rows.map(row=>{const fields=Object.fromEntries(parsed.headers.map((header,index)=>[header,row.values[index]?.trim()??'']));const item=manualItemPayload({...fields,itemKind:fields.itemKind||'product'});if(seen.has(item.productRef))fail('El archivo contiene referencias repetidas.');seen.add(item.productRef);const current=items.find(i=>i.source==='catalog:csv'&&i.productRef===item.productRef);const revision=Number(fields.revision||0);if(!Number.isInteger(revision)||revision<0)fail('La revisión debe ser un entero no negativo.');if(fields.active&&!['true','false'].includes(fields.active))fail('active admite true o false.');return {...item,active:fields.active!=='false',source:'catalog:csv',origin:'csv',revision,currentRevision:current?.revision??0};});
}
export function demoRewardWorkspace(url,options={}){
 const path=url.pathname,method=options.method??'GET',body=options.body?JSON.parse(options.body):{};
 if(path==='/api/admin/reward-workspace'&&method==='GET')return copy({ok:true,rewards,branches,features,region});
 if(path==='/api/admin/reward-workspace'&&method==='POST'){
  const previous=replay(body,path);if(previous)return previous;
  const existing=body.rewardId?rewards.find(r=>r.id===body.rewardId):null;if(body.rewardId&&!existing)fail('Recompensa no encontrada.',404);if(existing&&body.version!==existing.version)fail('La recompensa cambió. Actualiza antes de guardar.',409);
  const normalized=rewardPayload(rewardDraft({...body.reward,unit_cost_q:body.unitCostQ??null,available:body.available}));
  if(body.reward.branch_ids.some(id=>!branches.some(b=>b.id===id)))fail('Selecciona una sucursal de este negocio.');
  const mappings=copy(existing?.mappings??[]);
  if(body.mapping){const input=body.mapping,item=items.find(item=>item.id===input.catalogItemId);if(!item||!item.active)fail('El artículo no está disponible.');const old=input.id?mappings.find(m=>m.id===input.id):null;if((old?.version??0)!==input.version||(input.id&&!old))fail('El vínculo cambió. Actualiza antes de guardar.',409);if(input.inventoryRequired&&!canCheckInventory(item,input.branchId))fail('La comprobación requiere un producto sincronizado por un conector y una sucursal.');const mapped={id:old?.id??uuid(next++),version:input.version+1,catalog_item_id:item.id,source:item.source,product_ref:item.productRef,sku:item.sku,origin:item.origin,item_name:item.name,item_kind:item.itemKind,branch_id:input.branchId,quantity:input.quantity,inventory_required:input.inventoryRequired,enabled:input.enabled,inventory:inventory(item,input.branchId)};if(old)Object.assign(old,mapped);else mappings.push(mapped);}
  const saved={...normalized.reward,id:existing?.id??uuid(next++),version:`demo-${next++}`,unit_cost_q:Object.hasOwn(body,'unitCostQ')?body.unitCostQ:existing?.unit_cost_q??null,available:body.available,mappings};
  if(existing)Object.assign(existing,saved);else rewards.push(saved);
  return remember(body,path,{ok:true,reward:copy(saved),replay:false});
 }
 if(path==='/api/admin/merchant-catalog'&&method==='GET'){
  const query=(url.searchParams.get('query')??'').toLocaleLowerCase(),offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??30),branchId=url.searchParams.get('branchId');
  const filtered=items.filter(i=>`${i.name} ${i.sku??''} ${i.productRef}`.toLocaleLowerCase().includes(query)&&(url.searchParams.get('source')==null||i.source===url.searchParams.get('source')));
  return copy({ok:true,items:filtered.slice(offset,offset+limit).map(item=>({...item,inventory:inventory(item,branchId)})),sources:[...new Set(items.map(i=>i.source))].map(source=>({source})),hasMore:offset+limit<filtered.length,offset,limit});
 }
 if(path==='/api/admin/merchant-catalog/items'&&method==='PUT'){
  const previous=replay(body,path);if(previous)return previous;const normalized=manualItemPayload(body);if(items.some(i=>i.source==='catalog:manual'&&i.productRef===normalized.productRef))fail('El artículo ya existe. Actualiza el catálogo.',409);
  const item={...normalized,id:uuid(next++),revision:1,source:'catalog:manual',origin:'manual',observedAt:null};items.push(item);return remember(body,path,{ok:true,item:copy(item),replay:false});
 }
 if(path==='/api/admin/merchant-catalog/csv/preview'&&method==='POST'){const rows=previewCsv(body.csv);return copy({ok:true,items:rows,rowCount:rows.length});}
 if(path==='/api/admin/merchant-catalog/csv/import'&&method==='POST'){
  const previous=replay(body,path);if(previous)return previous;const rows=previewCsv(body.csv).map(row=>{if(row.revision!==row.currentRevision)fail('El artículo cambió. Revisa su revisión antes de importar.',409);return row;}).map(row=>{const old=items.find(i=>i.source===row.source&&i.productRef===row.productRef);return {...row,id:old?.id??uuid(next++),revision:row.revision+1,observedAt:null};});
  for(const row of rows){const old=items.find(i=>i.id===row.id);if(old)Object.assign(old,row);else items.push(row);}return remember(body,path,{ok:true,items:copy(rows),rowCount:rows.length,replay:false});
 }
 if(path==='/api/admin/pos-checkout/sources'&&method==='GET')return copy({ok:true,sources,catalog_sources:[{source:'Caja de ejemplo'}],branches,staff,features});
 if(path==='/api/admin/pos-checkout/sources'&&method==='PUT'){
  const person=staff.find(s=>s.id===body.staffId&&s.active);if(!person||person.branch_id!==(body.branchId??null))fail('Selecciona una cuenta PF de esta sucursal.');if(body.source!=='Caja de ejemplo')fail('Selecciona una caja del catálogo.');const existing=sources.find(s=>s.source===body.source&&s.branch_id===(body.branchId??null));if((existing?.version??0)!==body.version)fail('La configuración cambió. Actualiza antes de guardar.',409);const saved={source:body.source,branch_id:body.branchId??null,staff_user_id:body.staffId,enabled:!!body.enabled,version:body.version+1};if(existing)Object.assign(existing,saved);else sources.push(saved);return copy({ok:true,source:saved});
 }
 fail('Acción no disponible en esta demostración.',404);
}
