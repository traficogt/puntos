import assert from 'node:assert/strict';
import {test} from 'node:test';

const load=()=>import('../src/reward-workspace-model.js').catch(()=>null);
const uuid=n=>`fa000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('reward drafts preserve unlimited quota, unknown cost and explicit zero independently',async()=>{
 const m=await load();assert.equal(typeof m?.rewardDraft,'function');
 const initial=m.rewardDraft({id:uuid(1),version:'v1',name:'Café',description:'De la casa',points_cost:50,stock:null,active:true,available:true,unit_cost_q:null,branch_ids:[]});
 assert.equal(initial.unlimited,true);assert.equal(initial.unitCost,'');
 let result=m.rewardPayload(initial);
 assert.equal(result.reward.stock,null);assert.equal(result.unitCostQ,null);assert.equal(result.rewardId,uuid(1));assert.equal(result.version,'v1');assert.equal(Object.hasOwn(result,'mapping'),false);
 result=m.rewardPayload({...initial,unlimited:false,quota:'0',unitCost:'0'});
 assert.equal(result.reward.stock,0);assert.equal(result.unitCostQ,0);
 assert.throws(()=>m.rewardPayload({...initial,unlimited:false,quota:''}),/límite/i);
 assert.throws(()=>m.rewardPayload({...initial,points:'0'}),/puntos/i);
 assert.throws(()=>m.rewardPayload({...initial,unitCost:'abc'}),/costo/i);
});
test('reward drafts preserve expiry and protected term metadata without inventing a mapping edit',async()=>{
 const m=await load();assert.equal(typeof m?.rewardPayload,'function');
 const value={id:uuid(1),version:'etag-2',name:'Servicio',points_cost:40,description:'',stock:4,active:true,available:false,valid_until:'2027-03-12T18:30:41.123Z',branch_ids:[uuid(5)],mappings:[{id:uuid(7),version:3,source:'pos',product_ref:'S1',quantity:1,branch_id:uuid(5),enabled:true}]};
 const draft=m.rewardDraft(value),payload=m.rewardPayload(draft);
 assert.equal(payload.reward.valid_until,value.valid_until);assert.deepEqual(payload.reward.branch_ids,value.branch_ids);assert.equal(payload.available,false);assert.equal(Object.hasOwn(payload,'mapping'),false);
 assert.throws(()=>m.rewardPayload({...draft,allBranches:false,branchIds:[]}),/sucursal/i);
});
test('inventory checks need a product and branch; mapping edit keeps its version',async()=>{
 const m=await load();assert.equal(typeof m?.rewardPayload,'function');
 const draft={...m.rewardDraft(),name:'Café',points:'50',mappingDirty:true,catalogItem:{id:uuid(9),name:'Café',itemKind:'product',origin:'connector'},mappingBranchId:uuid(5),quantity:'0.123456',inventoryRequired:true,mappingId:uuid(7),mappingVersion:3};
 const payload=m.rewardPayload(draft);
 assert.equal(payload.mapping.catalogItemId,uuid(9));assert.equal(payload.mapping.quantity,0.123456);assert.equal(payload.mapping.version,3);
 assert.throws(()=>m.rewardPayload({...draft,mappingBranchId:''}),/sucursal/i);
 assert.throws(()=>m.rewardPayload({...draft,catalogItem:{...draft.catalogItem,itemKind:'service'}}),/servicio/i);
 assert.throws(()=>m.rewardPayload({...draft,quantity:'0.0000001'}),/cantidad/i);
});
test('inventory messages never turn absent or old evidence into availability',async()=>{
 const m=await load();assert.equal(typeof m?.inventoryDescription,'function');
 assert.match(m.inventoryDescription(null).label,/Sin comprobación/);
 assert.match(m.inventoryDescription({state:'stale',quantity:20}).label,/desactualizada/);
 assert.equal(m.inventoryDescription({state:'available',quantity:3}).color,'teal');
 assert.match(m.inventoryDescription({state:'unavailable',quantity:0}).label,/insuficientes/);
 assert.match(m.inventoryDescription({state:'not_applicable'}).label,/servicio/i);
});
test('manual catalog entry validates text and creates stable identity without a POS',async()=>{
 const m=await load();assert.equal(typeof m?.manualItemPayload,'function');
 const body=m.manualItemPayload({name:' Café ',sku:' C-01 ',itemKind:'product',productRef:'PF-EXAMPLE'});
 assert.equal(body.name,'Café');assert.equal(body.sku,'C-01');assert.equal(body.productRef,'PF-EXAMPLE');assert.equal(body.revision,0);
 assert.throws(()=>m.manualItemPayload({...body,name:''}),/nombre/i);
});

test('demo workspace saves reward plus mapping atomically and replays the original response',async()=>{
 const m=await import('../src/demo-reward-workspace.js').catch(()=>null);assert.equal(typeof m?.demoRewardWorkspace,'function');
 const call=(path,method='GET',body)=>m.demoRewardWorkspace(new URL(path,'https://demo.invalid'),{method,body:JSON.stringify(body)});
 const base='/api/admin/reward-workspace',catalog='/api/admin/merchant-catalog';
 const before=call(base),item=call(catalog).items[0],row=before.rewards[0];
 const model=await load(),draft={...model.rewardDraft(row),name:'Café actualizado',mappingDirty:true,catalogItem:item,quantity:'1',mappingBranchId:before.branches[0].id};
 const payload={...model.rewardPayload(draft),requestId:uuid(101)};
 assert.throws(()=>call(base,'POST',{...payload,mapping:{...payload.mapping,catalogItemId:uuid(999)}}));
 assert.equal(call(base).rewards[0].name,row.name);
 const saved=call(base,'POST',payload);assert.equal(saved.reward.name,'Café actualizado');assert.equal(saved.reward.mappings.length,1);
 const replay=call(base,'POST',payload);assert.equal(replay.replay,true);assert.equal(replay.reward.version,saved.reward.version);
 assert.throws(()=>call(base,'POST',{...payload,reward:{...payload.reward,name:'Otro'}}),/solicitud/i);
 assert.throws(()=>call(base,'POST',{...payload,requestId:uuid(102)}),/cambió/i);
});
test('demo catalog previews CSV without applying, imports exact retries once and preserves input identity',async()=>{
 const m=await import('../src/demo-reward-workspace.js').catch(()=>null);assert.equal(typeof m?.demoRewardWorkspace,'function');
 const call=(path,method='GET',body)=>m.demoRewardWorkspace(new URL(path,'https://demo.invalid'),{method,body:JSON.stringify(body)});
 const base='/api/admin/merchant-catalog',csv='productRef,sku,name,itemKind,active,revision\nTEST-CSV-01,SKU-CSV,Artículo de prueba,product,true,0';
 const before=call(base).items.length,preview=call(`${base}/csv/preview`,'POST',{csv});assert.equal(preview.rowCount,1);assert.equal(call(base).items.length,before);
 const body={requestId:uuid(111),csv};assert.equal(call(`${base}/csv/import`,'POST',body).rowCount,1);assert.equal(call(`${base}/csv/import`,'POST',body).replay,true);assert.equal(call(`${base}?query=SKU-CSV`).items.length,1);
 assert.throws(()=>call(`${base}/csv/import`,'POST',{...body,csv:csv.replace('Artículo','Distinto')}),/solicitud/i);
 assert.throws(()=>call(`${base}/csv/preview`,'POST',{csv:'name\nIncomplete'}));
});
test('demo checkout opt-in binds an active PF account in the exact branch and detects stale changes',async()=>{
 const m=await import('../src/demo-reward-workspace.js').catch(()=>null);assert.equal(typeof m?.demoRewardWorkspace,'function');
 const call=(method='GET',body)=>m.demoRewardWorkspace(new URL('/api/admin/pos-checkout/sources','https://demo.invalid'),{method,body:JSON.stringify(body)});
 const data=call(),branch=data.branches[0],staff=data.staff.find(s=>s.branch_id===branch.id);
 const body={source:data.catalog_sources[0].source,branchId:branch.id,staffId:staff.id,enabled:true,version:0};
 assert.throws(()=>call('PUT',{...body,branchId:data.branches[1].id}),/sucursal/i);
 assert.equal(call('PUT',body).source.enabled,true);assert.throws(()=>call('PUT',body),/cambió/i);
});

test('quantity requirements and freshness qualify inventory labels; depleted rewards remain distinct from active flag',async()=>{
 const m=await load();assert.equal(typeof m?.rewardStatus,'function');
 assert.match(m.inventoryDescription({state:'available',quantity:1},2).label,/insuficientes/);
 assert.equal(m.rewardStatus({active:true,available:true,stock:0}).label,'Límite agotado');
 assert.equal(m.rewardStatus({active:true,available:true,stock:null,valid_until:'2020-01-01'}).label,'Vencida');
 assert.equal(m.rewardStatus({active:true,available:false,stock:null}).label,'Entrega pausada');
});
test('catalog SKU field and CSV preview revisions match server limits before applying',async()=>{
 const m=await load();assert.equal(typeof m?.catalogPreviewIssues,'function');
 assert.throws(()=>m.manualItemPayload({name:'Artículo',sku:'S'.repeat(101),itemKind:'product',productRef:'TEST'}),/SKU/i);
 assert.deepEqual(m.catalogPreviewIssues([{revision:0,currentRevision:0}]),[]);
 assert.equal(m.catalogPreviewIssues([{productRef:'A',revision:0,currentRevision:3}]).length,1);
});

test('blank numeric fields cannot silently become zero and regional minor units are respected',async()=>{
 const m=await load(),draft={...m.rewardDraft(),name:'Premio',points:'50',unitCost:'   '};
 assert.equal(m.rewardPayload(draft).unitCostQ,null);
 assert.throws(()=>m.rewardPayload({...draft,unlimited:false,quota:' '}),/límite/i);
 assert.throws(()=>m.rewardPayload({...draft,unitCost:'0.5'},{minorUnits:0}),/costo/i);
 assert.equal(Object.hasOwn(m.rewardPayload({...draft,unitCost:'invalid'},{includeCost:false}),'unitCostQ'),false);
});

test('editing cost alone preserves a nullable protected description',async()=>{
 const m=await load();const draft=m.rewardDraft({name:'Premio',description:null,points_cost:50,unit_cost_q:null});
 assert.equal(m.rewardPayload({...draft,unitCost:'4.50'}).reward.description,null);
 assert.equal(m.rewardPayload({...draft,description:' Nuevo detalle '}).reward.description,'Nuevo detalle');
});

test('physical inventory checks are limited to synced products in an assigned branch',async()=>{
 const m=await load();assert.equal(typeof m?.canCheckInventory,'function');
 const manual={id:uuid(9),name:'Manual',itemKind:'product',origin:'manual',source:'catalog:manual'};
 assert.equal(m.canCheckInventory(manual,uuid(5)),false);assert.equal(m.canCheckInventory({...manual,origin:'csv',source:'catalog:csv'},uuid(5)),false);
 const synced={...manual,origin:'connector',source:'Caja conectada'};assert.equal(m.canCheckInventory(synced,''),false);assert.equal(m.canCheckInventory(synced,uuid(5)),true);assert.equal(m.canCheckInventory({...synced,itemKind:'service'},uuid(5)),false);
 const draft={...m.rewardDraft(),name:'Premio',points:'50',mappingDirty:true,catalogItem:manual,mappingBranchId:uuid(5),inventoryRequired:true};assert.throws(()=>m.rewardPayload(draft),/conector|sincronizado/i);
 const demo=await import('../src/demo-reward-workspace.js');const data=demo.demoRewardWorkspace(new URL('/api/admin/merchant-catalog','https://demo.invalid'));const local=demo.demoRewardWorkspace(new URL('/api/admin/merchant-catalog/items','https://demo.invalid'),{method:'PUT',body:JSON.stringify({requestId:uuid(991),productRef:'LOCAL-CHECK',sku:null,name:'Manual check',itemKind:'product',active:true,revision:0})}).item;
 assert.equal(data.items.some(item=>item.origin==='connector'),true);
 const body={requestId:uuid(992),reward:{name:'Manual inventory rejection',description:null,points_cost:10,active:true,stock:null,valid_until:null,branch_ids:[]},available:true,mapping:{catalogItemId:local.id,branchId:uuid(201),quantity:1,inventoryRequired:true,enabled:true,version:0}};
 assert.throws(()=>demo.demoRewardWorkspace(new URL('/api/admin/reward-workspace','https://demo.invalid'),{method:'POST',body:JSON.stringify(body)}),/conector|sincronizado/i);
});
