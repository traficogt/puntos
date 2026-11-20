export function basePointsPreview(program,quantity){
 if(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(program?.rate)||program.rate<=0)return null;
 if(program.program_type==='SPEND')return ({ceil:Math.ceil,round:Math.round,floor:Math.floor}[program.round]||Math.ceil)(quantity*program.rate);
 if(!['VISIT','ITEM'].includes(program.program_type))return null;
 return Math.floor(Math.max(1,Math.floor(quantity))*program.rate);
}
/** @param {import('./types/models').LaunchReadinessInput} [input] */
export function launchReadiness({program,rewards,pilot,branches}={},now=Date.now()){
 const required=pilot?.checks?.filter(c=>c.required)||[];
 const readyRewards=Array.isArray(rewards)?rewards.flatMap(reward=>{
  if(!reward.active||!Number.isSafeInteger(Number(reward.points_cost))||Number(reward.points_cost)<1)return [];
  if(reward.stock!=null&&(!Number.isSafeInteger(Number(reward.stock))||Number(reward.stock)<=0))return [];
  if(reward.valid_until&&!(Date.parse(reward.valid_until)>now))return [];
  const required=(reward.mappings||[]).filter(mapping=>mapping.enabled&&mapping.inventory_required);
  // Callers with a workspace use its configured branches. The null branch
  // preserves manual checkout for a business that has no configured branches.
  const configured=branches??[{id:null,name:null}];
  const scoped=reward.branch_ids?.length?configured.filter(branch=>reward.branch_ids.includes(branch.id)):configured.length?configured:[{id:null,name:null}];
  const evidence=scoped.map(branch=>{
   const checks=required.filter(mapping=>(mapping.branch_id??null)===branch.id);
   if(!checks.length)return {branchId:branch.id,branchName:branch.name,state:'not_required'};
   const mapping=checks[0],inventory=mapping.inventory,observed=Date.parse(inventory?.observedAt),quantity=Number(mapping.quantity);
   const state=checks.length===1&&inventory?.state==='available'&&quantity>0&&Number(inventory.quantity)>=quantity?'available':'unknown';
   return {branchId:branch.id,branchName:branch.name,state,observedAt:inventory?.observedAt,freshUntil:Number.isFinite(observed)?new Date(observed+300000).toISOString():null};
  });
  const view=branch=>getRewardViewModel(0,{...reward,inventory:{state:'unknown',required:true,branches:[branch]}},now);
  const usable=evidence.filter(branch=>view(branch).available);
  if(!usable.length)return [];
  return [{...reward,ready_branch_labels:usable.map(branch=>branch.branchName).filter(Boolean),limited_availability:usable.length<scoped.length}];
 }):null;
 const isDiscount=program?.program_type==='DISCOUNT';
 const isStamp=program?.program_type==='STAMP';
 const programReady=isDiscount
  ?typeof program?.percent_off==='number'&&Number.isFinite(program.percent_off)&&program.percent_off>0&&program.percent_off<=100
  :isStamp
  ?Number.isInteger(Number(program?.stamps_required))&&Number(program.stamps_required)>=2&&typeof program?.reward_label==='string'&&program.reward_label.trim().length>0
  :['SPEND','VISIT','ITEM'].includes(program?.program_type)&&typeof program?.rate==='number'&&Number.isFinite(program.rate)&&program.rate>0;
 return {program:programReady,requiresRewards:!isDiscount&&!isStamp,
 activeRewards:readyRewards?.length??null,readyRewards,
 unknownRewardCosts:readyRewards?.filter(reward=>reward.unit_cost_q==null||!Number.isFinite(Number(reward.unit_cost_q))||Number(reward.unit_cost_q)<0).length??null,
 physicalPassed:required.filter(c=>c.status==='passed').length,physicalTotal:required.length};
}

export function firstLaunchStep(readiness,practiceComplete=false){
 if(!readiness.program)return 'program';
 if(readiness.requiresRewards!==false&&!readiness.activeRewards)return 'rewards';
 return practiceComplete?'launch':'data';
}
/** Shape of a stamp card for the editor preview: gifted stamps and the real purchases needed. */
export function stampPreview(program){
 if(program?.program_type!=='STAMP')return null;
 const req=Number(program?.stamps_required);
 if(!Number.isInteger(req)||req<2)return null;
 const hsRaw=program?.head_start;
 const hs=hsRaw===''||hsRaw==null?Math.min(req-1,2):Math.min(req-1,Math.max(0,Number.isFinite(Number(hsRaw))?Math.floor(Number(hsRaw)):2));
 return {stamps_required:req,head_start:hs,purchases_required:req-hs};
}
/** Quetzales taken off a sample purchase for a member discount program. */
export function discountPreview(program,quantity){
 if(program?.program_type!=='DISCOUNT')return null;
 if(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0)return null;
 const pct=Number(program?.percent_off);
 if(!Number.isFinite(pct)||pct<=0)return null;
 return Math.round(quantity*Math.min(100,pct))/100;
}

export function launchPilot(pilots = []) {
 return pilots.find(p=>p.status==='active') ?? pilots.filter(p=>p.status==='completed').sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at))[0] ?? null;
}
import {getRewardViewModel} from '../../../public/customer/rewards.js';
