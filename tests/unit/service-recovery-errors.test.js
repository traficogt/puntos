import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { errorHandler } from '../../src/middleware/common.js';
import { redemptionFailureKind,recordFailedRedemption } from '../../src/app/services/service-recovery-service.js';
import * as staffService from '../../src/app/services/staff-service.js';
it('adds only a validated optional recovery identifier to the original error envelope',()=>{
 const caseId=randomUUID(),error=Object.assign(new Error('Reward out of stock'),{statusCode:409,recoveryCaseId:String(caseId)}),req={id:'request-123',headers:{}};
 /** @type {any} */ let body;let status;const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;}};
 errorHandler(error,req,res,()=>{});assert.equal(status,409);assert.deepEqual(body,{error:'Reward out of stock',code:'CONFLICT',request_id:'request-123',recoveryCaseId:caseId});
 error.recoveryCaseId='private customer note';errorHandler(error,req,res,()=>{});assert.equal(body.recoveryCaseId,undefined);
});
it('records only known completed rejection errors and never substitutes a recording failure',async()=>{
 assert.equal(redemptionFailureKind({statusCode:409,message:'Insufficient points'}),'redemption_failed');
 for(const error of [{statusCode:500,message:'Reward out of stock'},{statusCode:404,message:'Customer not found'},{statusCode:403,message:'Reward belongs to different business'},{statusCode:409,message:'requestId already used for a different redemption'}])assert.equal(redemptionFailureKind(error),null);
 const requestId=randomUUID(),payload={customerId:randomUUID(),rewardId:randomUUID(),staff:{business_id:randomUUID()},requestId,error:{statusCode:409,message:'Reward out of stock'}};
 assert.equal(await recordFailedRedemption(payload,{createCase:async()=>{throw new Error('database down');}}),null);
 const id=randomUUID();assert.equal(await recordFailedRedemption(payload,{createCase:async args=>{assert.equal(args.requestId,requestId);assert.equal(args.kind,'redemption_failed');return {case:{id}};}}),id);
});
it('captures a case only after redemption rollback completes and rethrows the original error',async()=>{
 assert.equal(typeof staffService.redeemRewardWithRecovery,'function');const original=Object.assign(new Error('Reward out of stock'),{statusCode:409});const calls=[];const caseId=randomUUID();
 await assert.rejects(staffService.redeemRewardWithRecovery({}, {redeem:async()=>{calls.push('rolled_back');throw original;},record:async()=>{assert.deepEqual(calls,['rolled_back']);calls.push('case');return caseId;}}),e=>e===original&&original['recoveryCaseId']===caseId);
 const other=Object.assign(new Error('Insufficient points'),{statusCode:409});await assert.rejects(staffService.redeemRewardWithRecovery({}, {redeem:async()=>{throw other;},record:async()=>{throw new Error('audit down');}}),e=>e===other);
});
