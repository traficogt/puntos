import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import pg from 'pg';
import {getDataHealth,saveDataHealth,recordDataHeartbeat} from '../../src/app/services/data-health-service.js';
import {readinessForBusiness} from '../../src/app/services/merchant-data-readiness.js';
import {getPlatformOperationsHealth} from '../../src/app/services/platform-health-service.js';
import {closeDatabase} from '../../src/app/database.js';
const enabled=process.env.DB_NAME==='operations_completion_test'&&process.env.NODE_ENV==='test';
const run=enabled?test:test.skip;
const bid=randomUUID(),other=randomUUID(),staff=randomUUID(),monitor=randomUUID();
let pool;
const now=new Date('2026-11-13T18:00:00Z');
const source={id:monitor,source:'odoo',label:'Caja conectada',branch_id:null,expected_minutes:60,enabled:true};
const deps=()=>({query:pool.query.bind(pool),now:()=>now,transaction:async fn=>{
 const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}});
before(async()=>{if(!enabled)return;
 pool=new pg.Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
 await pool.query("INSERT INTO businesses(id,name,slug,email,password_hash) VALUES($1,'Operations fixture',$2,'ops@example.invalid','fixture'),($3,'Other fixture',$4,'other@example.invalid','fixture')",[bid,`ops-${bid}`,other,`other-${other}`]);
 await pool.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner','owner@example.invalid','fixture','OWNER')",[staff,bid]);
});
after(async()=>{if(pool){await pool.query('DELETE FROM businesses WHERE id=ANY($1::uuid[])',[[bid,other]]);await pool.end();}await closeDatabase();});
run('configuration preserves unrelated settings and blocks inactivity before first sync',async()=>{
 await pool.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[bid,{preserved:true}]);
 const first=await getDataHealth({businessId:bid},deps());
 const saved=await saveDataHealth({businessId:bid,staffId:staff,input:{version:first.version,sources:[source]}},deps());
 assert.equal(saved.sources.length,1);
 const b=(await pool.query('SELECT * FROM businesses WHERE id=$1',[bid])).rows[0];
 assert.equal(b.program_json.preserved,true);assert.equal(readinessForBusiness(b,now).inactivity_allowed,false);
 await assert.rejects(saveDataHealth({businessId:bid,staffId:staff,input:{version:first.version,sources:[]}},deps()),{statusCode:409});
});
run('integration heartbeat is idempotent, monotonic and tenant-bound',async()=>{
 const input={request_id:randomUUID(),monitor_id:monitor,coverage_through:now.toISOString(),status:'complete',pending:0,errors:0};
 assert.equal((await recordDataHeartbeat({id:bid},input,deps())).replayed,false);
 assert.equal((await recordDataHeartbeat({id:bid},input,deps())).replayed,true);
 await assert.rejects(recordDataHeartbeat({id:bid},{...input,errors:1},deps()),{statusCode:409});
 await assert.rejects(recordDataHeartbeat({id:other},{...input,request_id:randomUUID()},deps()),{statusCode:404});
 await assert.rejects(recordDataHeartbeat({id:bid},{...input,request_id:randomUUID(),coverage_through:'2026-11-13T17:00:00Z'},deps()),{statusCode:409});
 const current=await getDataHealth({businessId:bid},deps());assert.equal(current.readiness.state,'ready');assert.equal(current.events.length,1);
});
run('configuration rejects foreign branches and concurrent stale revisions',async()=>{
 const branch=randomUUID();await pool.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Other branch','TEST')",[branch,other]);
 const current=await getDataHealth({businessId:bid},deps());
 await assert.rejects(saveDataHealth({businessId:bid,staffId:staff,input:{version:current.version,sources:[{...source,branch_id:branch}]}},deps()),{statusCode:400});
 const opts={businessId:bid,staffId:staff,input:{version:current.version,sources:[{...source,expected_minutes:120}]}};
 const results=await Promise.allSettled([saveDataHealth(opts,deps()),saveDataHealth(opts,deps())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
run('platform overview requires platform authority and never returns credentials',async()=>{
 await assert.rejects(getPlatformOperationsHealth({},{...deps(),isPlatformAdmin:()=>false}),{statusCode:403});
 const out=await getPlatformOperationsHealth({limit:100,offset:0},{...deps(),isPlatformAdmin:()=>true});
 const row=out.businesses.find(b=>b.id===bid);assert.ok(row);assert.equal(row.readiness.state,'ready');
 assert.equal(JSON.stringify(out).includes('password_hash'),false);assert.equal(JSON.stringify(out).includes('program_json'),false);
});
run('transaction inserts and status changes retain immutable chronological evidence',async()=>{
 const cid=randomUUID(),tid=randomUUID();await pool.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Fixture',$3)",[cid,bid,cid]);
 await pool.query("INSERT INTO transactions(id,business_id,customer_id,type,source,points,status,amount_q,visits,items) VALUES($1,$2,$3,'PURCHASE','online',10,'PENDING',100,1,1)",[tid,bid,cid]);
 await pool.query("UPDATE transactions SET status='POSTED' WHERE id=$1",[tid]);
 const {rows}=await pool.query('SELECT * FROM transaction_evidence_events WHERE business_id=$1 AND transaction_id=$2 ORDER BY created_at,id',[bid,tid]);
 assert.equal(rows.length,2);assert.equal(rows[0].recorded_state.status,'PENDING');assert.equal(rows[1].previous_state.status,'PENDING');assert.equal(rows[1].recorded_state.status,'POSTED');
 await assert.rejects(pool.query("UPDATE transaction_evidence_events SET recorded_state='{}' WHERE id=$1",[rows[0].id]),/immutable/);
});
