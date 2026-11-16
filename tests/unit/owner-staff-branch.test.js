import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {pool} from '../../src/app/database.js';
import {config} from '../../src/config/index.js';
import {errorHandler} from '../../src/middleware/common.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {BranchRepo} from '../../src/app/repositories/branch-repository.js';
import {BusinessRepo} from '../../src/app/repositories/business-repository.js';
import {PlanConfigService} from '../../src/app/services/plan-config-service.js';
import {adminStaffRoutes} from '../../src/app/routes/admin/staff.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
const businessId=randomUUID(),staffId=randomUUID(),branchId=randomUUID(),foreignBranchId=randomUUID(),csrf='staff-branch-fixture';
const originals={staff:StaffRepo.getById,email:StaffRepo.getByEmail,create:StaffRepo.create,branch:BranchRepo.getById,business:BusinessRepo.getById,plans:PlanConfigService.getPlanFeatureOverrides,query:pool.query};
let server,origin,cookie,created,ownerBranch;
before(async()=>{
 StaffRepo.getById=async id=>id===staffId?{id,business_id:businessId,role:'OWNER',branch_id:ownerBranch,active:true}:created;
 StaffRepo.getByEmail=async()=>null;
 StaffRepo.create=async args=>(created={...args});
 BranchRepo.getById=async id=>id===branchId?{id,business_id:businessId}:id===foreignBranchId?{id,business_id:randomUUID()}:null;
 BusinessRepo.getById=async()=>({id:businessId,plan:'NEGOCIO'});PlanConfigService.getPlanFeatureOverrides=async()=>({});pool.query=async()=>({rows:[],rowCount:0});
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER',reauthVerified:true});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const app=express();app.use(express.json(),cookieParser());app.use('/api',adminStaffRoutes);app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(()=>{created=null;ownerBranch=branchId;});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=originals.staff;StaffRepo.getByEmail=originals.email;StaffRepo.create=originals.create;BranchRepo.getById=originals.branch;BusinessRepo.getById=originals.business;PlanConfigService.getPlanFeatureOverrides=originals.plans;pool.query=originals.query;});
async function create(branch_id){return fetch(`${origin}/api/admin/staff`,{method:'POST',headers:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({name:'Nueva persona',email:'nueva@example.invalid',password:'Volcanes nube 8492!',...(branch_id?{branch_id}:{})})});}
test('staff creation rejects nonexistent and foreign branches before inserting an account',async()=>{for(const id of [randomUUID(),foreignBranchId]){assert.equal((await create(id)).status,400);assert.equal(created,null);}});
test('staff creation validates the inherited branch and preserves valid explicit/default/unassigned scopes',async()=>{
 ownerBranch=foreignBranchId;assert.equal((await create()).status,400);assert.equal(created,null);
 for(const [assigned,inherited,expected] of [[branchId,null,branchId],[undefined,branchId,branchId],[undefined,null,null]]){ownerBranch=inherited;assert.equal((await create(assigned)).status,200);assert.equal(created.branch_id,expected);assert.equal(created.business_id,businessId);}
});
