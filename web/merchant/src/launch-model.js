export function basePointsPreview(program,quantity){
 if(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(program?.rate)||program.rate<=0)return null;
 if(program.program_type==='SPEND')return ({ceil:Math.ceil,round:Math.round,floor:Math.floor}[program.round]||Math.ceil)(quantity*program.rate);
 if(!['VISIT','ITEM'].includes(program.program_type))return null;
 return Math.floor(Math.max(1,Math.floor(quantity))*program.rate);
}
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
 return {program:['SPEND','VISIT','ITEM'].includes(program?.program_type)&&typeof program?.rate==='number'&&Number.isFinite(program.rate)&&program.rate>0,
 activeRewards:readyRewards?.length??null,readyRewards,
 unknownRewardCosts:readyRewards?.filter(reward=>reward.unit_cost_q==null||!Number.isFinite(Number(reward.unit_cost_q))||Number(reward.unit_cost_q)<0).length??null,
 physicalPassed:required.filter(c=>c.status==='passed').length,physicalTotal:required.length};
}

export function firstLaunchStep(readiness,practiceComplete=false){
 if(!readiness.program)return 'program';
 if(!readiness.activeRewards)return 'rewards';
 return practiceComplete?'launch':'data';
}

export function launchPilot(pilots = []) {
 return pilots.find(p=>p.status==='active') ?? pilots.filter(p=>p.status==='completed').sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at))[0] ?? null;
}
import {getRewardViewModel} from '../../../public/customer/rewards.js';
