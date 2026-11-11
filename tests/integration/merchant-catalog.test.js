/* eslint-disable security/detect-non-literal-fs-filename -- Fixed fixture paths in a newly-created, guarded disposable database. */
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {runWithDbContext} from '../../src/app/database.js';
import {saveRewardPosMapping} from '../../src/app/services/reward-pos-mapping-service.js';
import * as catalog from '../../src/app/services/merchant-catalog-service.js';
import * as inventory from '../../src/app/services/reward-inventory-service.js';
const url=process.env.MERCHANT_CATALOG_TEST_ADMIN_URL,suite=url?test.describe:test.describe.skip;
const ids={business:randomUUID(),otherBusiness:randomUUID(),branch:randomUUID(),otherBranch:randomUUID(),owner:randomUUID(),reward:randomUUID()};
const owner={id:ids.owner,business_id:ids.business,role:'OWNER',branch_id:null},business={id:ids.business};
let db,admin,databaseName;
const scoped=(tenant=ids.business)=>({transaction:async fn=>{const client=await db.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE merchant_catalog_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[tenant]);const result=await runWithDbContext({client,tenantId:tenant},()=>fn(client));await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}});
const actor={businessId:ids.business,staff:owner};
const item={productRef:'widget:1',sku:'W1',name:'Widget',itemKind:'product',active:true};
const sync=(patch={})=>catalog.syncMerchantCatalog(business,{source:'shop:1',requestId:randomUUID(),observedAt:new Date(Date.now()-1000).toISOString(),items:[item],...patch},scoped());
const snapshot=(patch={})=>catalog.recordInventorySnapshot(business,{source:'shop:1',requestId:randomUUID(),branchId:ids.branch,observedAt:new Date(Date.now()-500).toISOString(),items:[{productRef:item.productRef,availableQuantity:5}],...patch},scoped());
const mapping=(patch={})=>saveRewardPosMapping({...actor,rewardId:ids.reward,input:{source:'shop:1',branchId:ids.branch,productRef:item.productRef,itemName:item.name,itemKind:'product',quantity:2,enabled:true,version:0,inventoryRequired:true,...patch}},scoped());
const check=()=>scoped().transaction(client=>inventory.getRewardInventory(client,{businessId:ids.business,rewardId:ids.reward,branchId:ids.branch}));
suite('generic catalog and inventory in restricted PostgreSQL',()=>{
 before(async()=>{
  assert.equal(typeof catalog.syncMerchantCatalog,'function');assert.equal(typeof inventory.getRewardInventory,'function');
  const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'55454');assert.equal(parsed.pathname,'/postgres');
  databaseName=`reward_catalog_test_${process.pid}_${Date.now()}`;assert.match(databaseName,/^reward_catalog_test_[0-9_]+$/);
  admin=new pg.Pool({connectionString:url});await admin.query(`CREATE DATABASE ${databaseName}`);parsed.pathname=`/${databaseName}`;db=new pg.Pool({connectionString:parsed.toString(),max:10});
  await db.query(await readFile(new URL('../fixtures/reward-economics.sql',import.meta.url),'utf8'));
  await db.query(`CREATE TABLE native_wallet_passes(id uuid PRIMARY KEY,business_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1,revoked_at timestamptz);CREATE TABLE branches(id uuid PRIMARY KEY,business_id uuid NOT NULL,name text);ALTER TABLE staff_users ADD COLUMN branch_id uuid;CREATE TABLE service_redemption_restorations(id uuid PRIMARY KEY,business_id uuid NOT NULL,redemption_id uuid NOT NULL);DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merchant_catalog_test_app') THEN CREATE ROLE merchant_catalog_test_app NOLOGIN;END IF;END $$;`);
  for(const file of ['2026-11-11-z-pos-fulfillment.sql','2026-11-11-z-reward-catalog.sql'])await db.query(await readFile(new URL(`../../src/app/migrations/${file}`,import.meta.url),'utf8'));
  await db.query('GRANT USAGE ON SCHEMA public,app TO merchant_catalog_test_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO merchant_catalog_test_app; REVOKE UPDATE ON merchant_catalog_events FROM merchant_catalog_test_app');
 });
 after(async()=>{await db?.end();if(admin&&databaseName)await admin.query(`DROP DATABASE ${databaseName}`);await admin?.end();});
 beforeEach(async()=>{
  await db.query('TRUNCATE native_wallet_passes,businesses,staff_users,rewards,audit_logs,branches CASCADE');
  await db.query("INSERT INTO businesses(id,plan) VALUES($1,'NEGOCIO'),($2,'NEGOCIO')",[ids.business,ids.otherBusiness]);
  await db.query("INSERT INTO branches VALUES($1,$2,'Principal'),($3,$4,'Otro negocio')",[ids.branch,ids.business,ids.otherBranch,ids.otherBusiness]);
  await db.query("INSERT INTO staff_users(id,business_id,role) VALUES($1,$2,'OWNER')",[ids.owner,ids.business]);
  await db.query("INSERT INTO rewards(id,business_id,name,points_cost,stock) VALUES($1,$2,'Premio',50,3)",[ids.reward,ids.business]);
 });
 test('manual items are owner-scoped, revisioned and exactly replayed even after edits',async()=>{
  const input={...item,requestId:randomUUID(),revision:0};
  const first=await catalog.saveManualCatalogItem({...actor,input},scoped());assert.equal(first.item.origin,'manual');
  await catalog.saveManualCatalogItem({...actor,input:{...input,name:'Changed',requestId:randomUUID(),revision:1}},scoped());
  const replay=await catalog.saveManualCatalogItem({...actor,input},scoped());assert.equal(replay.replay,true);assert.equal(replay.item.name,item.name);
  await assert.rejects(catalog.saveManualCatalogItem({...actor,input:{...input,name:'Different'}},scoped()),{statusCode:409});
  await assert.rejects(catalog.saveManualCatalogItem({...actor,input:{...input,requestId:randomUUID()}},scoped()),{statusCode:409});
  await db.query("UPDATE staff_users SET role='MANAGER'");await assert.rejects(catalog.saveManualCatalogItem({...actor,input},scoped()),{statusCode:403});
 });
 test('CSV previews exact revisions and imports atomically without impersonating a connector',async()=>{
  const csv='productRef,sku,name,itemKind,active,revision\nwidget:1,W1,Widget,product,true,0\nservice:1,,Service,service,true,0',input={requestId:randomUUID(),csv};
  const preview=await catalog.previewCatalogCsv({...actor,input:{csv}},scoped());assert.equal(preview.items[0].currentRevision,0);
  assert.equal((await catalog.importCatalogCsv({...actor,input},scoped())).rowCount,2);
  assert.equal((await catalog.importCatalogCsv({...actor,input},scoped())).replay,true);
  await assert.rejects(catalog.importCatalogCsv({...actor,input:{...input,requestId:randomUUID()}},scoped()),{statusCode:409});
  await sync();await snapshot();const out=await catalog.listMerchantCatalog({...actor,branchId:ids.branch,query:'Widget',offset:0,limit:1},scoped());assert.equal(out.items.length,1);assert.equal(out.hasMore,true);assert.equal(out.sources.length,2);
  const all=await catalog.listMerchantCatalog({...actor,branchId:ids.branch,offset:0,limit:30},scoped());assert.equal(all.items.find(row=>row.source==='catalog:csv'&&row.itemKind==='product').inventory.state,'unknown');assert.equal(all.items.find(row=>row.source==='shop:1').inventory.state,'available');
 });
 test('signed request identity is immutable across concurrent retries and different operations',async()=>{
  const input={source:'shop:1',requestId:'sync:one',observedAt:new Date(Date.now()-1000).toISOString(),items:[item]};
  const result=await Promise.all([catalog.syncMerchantCatalog(business,input,scoped()),catalog.syncMerchantCatalog(business,input,scoped())]);assert.equal(result.filter(row=>row.replay).length,1);
  await assert.rejects(catalog.syncMerchantCatalog(business,{...input,items:[{...item,name:'changed'}]},scoped()),{statusCode:409});
  await assert.rejects(snapshot({requestId:'sync:one'}),{statusCode:409});
  assert.equal((await db.query('SELECT * FROM merchant_catalog_events')).rowCount,1);
 });
 test('connector observation ordering, branch tenant and null unknown are fail-closed',async()=>{
  await sync();await snapshot();await mapping();assert.equal((await check()).state,'available');
  await assert.rejects(snapshot({observedAt:new Date(Date.now()+10000).toISOString()}),{statusCode:400});
  await assert.rejects(snapshot({observedAt:new Date(Date.now()-5000).toISOString()}),{statusCode:409});
  await assert.rejects(snapshot({branchId:ids.otherBranch}),{statusCode:400});
  await snapshot({observedAt:new Date().toISOString(),items:[{productRef:item.productRef,availableQuantity:null}]});assert.equal((await check()).state,'unknown');
  await assert.rejects(scoped().transaction(client=>inventory.assertRewardInventory(client,{businessId:ids.business,rewardId:ids.reward,branchId:ids.branch})),{statusCode:409});
  assert.equal((await db.query('SELECT stock FROM rewards')).rows[0].stock,3);
 });
 test('stale snapshots never imply availability and independent branches have independent freshness',async()=>{
  await sync({observedAt:new Date(Date.now()-600000).toISOString()});await snapshot({observedAt:new Date(Date.now()-301000).toISOString()});await mapping();assert.equal((await check()).state,'stale');
  await snapshot({items:[{productRef:item.productRef,availableQuantity:1}]});assert.equal((await check()).state,'unavailable');
  const second=randomUUID();await db.query("INSERT INTO branches VALUES($1,$2,'Segundo')",[second,ids.business]);await snapshot({branchId:second,observedAt:new Date(Date.now()-100000).toISOString()});
 });
 test('only one checked mapping applies per reward/branch and legacy omission preserves opt-in',async()=>{
  await sync();await mapping();await mapping({version:1,inventoryRequired:undefined});assert.equal((await db.query('SELECT inventory_required FROM reward_pos_mappings')).rows[0].inventory_required,true);
  assert.equal((await db.query('SELECT program_json FROM businesses WHERE id=$1',[ids.business])).rows[0].program_json.pos_inventory_checks,true);
  await sync({source:'shop:2'});await assert.rejects(mapping({source:'shop:2'}),{statusCode:409});
  await assert.rejects(mapping({version:2,itemKind:'service'}),{statusCode:400});await assert.rejects(mapping({version:2,branchId:null}),{statusCode:400});
 });
 test('disabled, inactive, missing and unverified catalog evidence cannot enable available stock',async()=>{
  assert.equal((await check()).state,'not_required');await sync();await mapping();assert.equal((await check()).state,'unknown');
  await snapshot();await sync({observedAt:new Date().toISOString(),items:[{...item,active:false}]});assert.equal((await check()).state,'unavailable');
  await assert.rejects(mapping({version:1,productRef:'missing'}),{statusCode:400});
 });
 test('CSV batch conflicts and audit errors roll back every item and request event',async()=>{
  const csv='productRef,name,itemKind,revision\nwidget:1,Widget,product,0';
  await catalog.importCatalogCsv({...actor,input:{requestId:randomUUID(),csv}},scoped());
  await assert.rejects(catalog.importCatalogCsv({...actor,input:{requestId:randomUUID(),csv:'productRef,name,itemKind,revision\nnew:1,New,product,0\nwidget:1,Changed,product,0'}},scoped()),{statusCode:409});
  assert.equal((await db.query("SELECT * FROM merchant_catalog_items WHERE product_ref='new:1'")).rowCount,0);
  await db.query("CREATE FUNCTION reject_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit()");
  try{await assert.rejects(catalog.saveManualCatalogItem({...actor,input:{...item,requestId:randomUUID(),revision:0}},scoped()),/fixture audit failure/);assert.equal((await db.query("SELECT * FROM merchant_catalog_items WHERE source='catalog:manual'")).rowCount,0);assert.equal((await db.query('SELECT * FROM merchant_catalog_events')).rowCount,1);}
  finally{await db.query('DROP TRIGGER reject_catalog_audit ON audit_logs; DROP FUNCTION reject_catalog_audit()');}
 });
 test('catalog checkpoints reject older metadata and service inventory remains not applicable',async()=>{
  const observedAt=new Date(Date.now()-1000).toISOString();await sync({observedAt});
  await assert.rejects(sync({observedAt:new Date(Date.now()-10000).toISOString()}),{statusCode:409});
  await assert.rejects(sync({observedAt,items:[{...item,name:'Changed'}]}),{statusCode:409});
  await sync({observedAt,items:[{...item,productRef:'service:1',itemKind:'service'}]});
  await assert.rejects(snapshot({items:[{productRef:'service:1',availableQuantity:1}]}),{statusCode:400});
  await snapshot({items:[{productRef:'service:1',availableQuantity:null}]});
  const out=await catalog.listMerchantCatalog({...actor,branchId:ids.branch,query:'service:1'},scoped());assert.equal(out.items[0].inventory.state,'not_applicable');
  await assert.rejects(catalog.listMerchantCatalog({...actor,branchId:ids.otherBranch},scoped()),{statusCode:400});
 });
 test('changed checked inventory marks active Wallet snapshots dirty transactionally and exact retries do not',async()=>{
  const pass=randomUUID(),other=randomUUID(),revoked=randomUUID();await db.query('INSERT INTO native_wallet_passes(id,business_id,revoked_at) VALUES($1,$2,NULL),($3,$4,NULL),($5,$2,now())',[pass,ids.business,other,ids.otherBusiness,revoked]);
  await sync();await mapping();const initial=(await db.query('SELECT revision FROM native_wallet_passes WHERE id=$1',[pass])).rows[0].revision;assert.equal(initial,2);
  const requestId=randomUUID(),observedAt=new Date().toISOString();await snapshot({requestId,observedAt});assert.equal((await db.query('SELECT revision FROM native_wallet_passes WHERE id=$1',[pass])).rows[0].revision,initial+1);await snapshot({requestId,observedAt});assert.equal((await db.query('SELECT revision FROM native_wallet_passes WHERE id=$1',[pass])).rows[0].revision,initial+1);
  await sync({observedAt:new Date().toISOString(),items:[{...item,active:false}]});assert.equal((await db.query('SELECT revision FROM native_wallet_passes WHERE id=$1',[pass])).rows[0].revision,initial+2);
  await mapping({version:1,enabled:false});assert.equal((await db.query('SELECT revision FROM native_wallet_passes WHERE id=$1',[pass])).rows[0].revision,initial+3);assert.ok((await db.query('SELECT revision FROM native_wallet_passes WHERE id<>$1',[pass])).rows.every(row=>row.revision===1));
 });
 test('tenant RLS isolates all catalog evidence and immutable event rows cannot be updated',async()=>{
  await sync();await snapshot();await scoped(ids.otherBusiness).transaction(async client=>{for(const table of ['merchant_catalog_items','merchant_catalog_sources','merchant_catalog_events','merchant_inventory_snapshots'])assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount,0);});
  await assert.rejects(scoped().transaction(client=>client.query("UPDATE merchant_catalog_events SET operation='manual'")),{code:'42501'});
 });
});
