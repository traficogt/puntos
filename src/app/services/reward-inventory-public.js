import {getRewardInventory,INVENTORY_FRESH_SECONDS} from './reward-inventory-service.js';

const usable=state=>state==='available'||state==='not_required';
const knownStates=new Set(['not_required','available','unavailable','unknown','stale']);
function publicEvidence(branch,evidence,now){
 const observed=Date.parse(evidence?.observedAt??'');
 let state=knownStates.has(evidence?.state)?evidence.state:'unknown';
 if(state==='available'){
  if(!Number.isFinite(observed)||observed>now)state='unknown';
  else if(now-observed>INVENTORY_FRESH_SECONDS*1000)state='stale';
 }
 return {branchId:branch.id??null,branchName:branch.name??null,state,
  observedAt:Number.isFinite(observed)?new Date(observed).toISOString():null,
  freshUntil:state==='available'?new Date(observed+INVENTORY_FRESH_SECONDS*1000).toISOString():null};
}
function aggregate(branches){
 const states=branches.map(branch=>branch.state);
 const state=['not_required','available','unknown','stale','unavailable'].find(value=>states.includes(value))??'unknown';
 return {state,required:!states.includes('not_required'),branches};
}

/** Add only public availability evidence; do not change reward or protected promise terms. */
export async function withPublicRewardAvailability(client,{business,rewards,branches=undefined,manualAvailabilityLoaded=false},injected={}){
 if(!rewards.length)return rewards;
 const ids=rewards.map(reward=>reward.id);
 const availability=manualAvailabilityLoaded?[]:(await client.query(
  'SELECT reward_id,available FROM reward_availability WHERE business_id=$1 AND reward_id=ANY($2::uuid[])',[business.id,ids])).rows;
 const manual=new Map(availability.map(row=>[row.reward_id,row.available]));
 const rows=rewards.map(reward=>({...reward,available:manual.has(reward.id)?manual.get(reward.id)!==false:reward.available!==false}));
 // Businesses without the opt-in never query the new inventory schema.
 if(business.program_json?.pos_inventory_checks!==true)return rows;
 const mappings=(await client.query(`SELECT reward_id,branch_id FROM reward_pos_mappings
  WHERE business_id=$1 AND reward_id=ANY($2::uuid[]) AND enabled AND inventory_required`,[business.id,ids])).rows;
 if(!mappings.length)return rows;
 const locations=branches??(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id',[business.id])).rows;
 const required=new Set(mappings.map(row=>`${row.reward_id}:${row.branch_id??''}`));
 const getInventory=injected.getInventory??getRewardInventory,now=injected.now??Date.now();
 const output=[];
 for(const reward of rows){
  const scoped=Array.isArray(reward.branch_ids)&&reward.branch_ids.length>0;
  const eligible=scoped?locations.filter(branch=>reward.branch_ids.includes(branch.id)):locations.length?locations:[{id:null,name:null}];
  if(!eligible.some(branch=>required.has(`${reward.id}:${branch.id??''}`))){output.push(reward);continue;}
  const evidence=[];
  for(const branch of eligible){
   const inventory=required.has(`${reward.id}:${branch.id??''}`)?await getInventory(client,{businessId:business.id,rewardId:reward.id,branchId:branch.id??null}):{state:'not_required'};
   evidence.push(publicEvidence(branch,inventory,now));
  }
  output.push({...reward,available:reward.available&&evidence.some(branch=>usable(branch.state)),inventory:aggregate(evidence)});
 }
 return output;
}

export async function withWalletRewardInventory(client,snapshot,injected={}){
 if(snapshot.is_voided||snapshot.revoked_at||snapshot.program_json?.pos_inventory_checks!==true)return snapshot;
 const wallet_rewards=await withPublicRewardAvailability(client,{business:{id:snapshot.business_id,program_json:snapshot.program_json},rewards:snapshot.wallet_rewards??[],branches:snapshot.wallet_branches??[],manualAvailabilityLoaded:true},injected);
 return {...snapshot,wallet_rewards};
}

/** Keep protected scope intact; narrow only live hints and refresh when evidence ages out. */
export function walletInventoryEngagement(snapshot,engagement){
 const inventory=snapshot.wallet_rewards?.find(reward=>reward.id===engagement.reward?.id)?.inventory;
 const now=Date.parse(snapshot.snapshot_at??'')||Date.now();
 const deadlines=(snapshot.wallet_rewards??[]).flatMap(reward=>(reward.inventory?.branches??[])
  .filter(branch=>branch.state==='available'&&branch.freshUntil).map(branch=>Date.parse(branch.freshUntil)+1)).filter(at=>Number.isFinite(at)&&at>now);
 if(engagement.next_refresh_at)deadlines.push(Date.parse(engagement.next_refresh_at));
 const next=deadlines.length?new Date(Math.min(...deadlines)).toISOString():engagement.next_refresh_at;
 if(!inventory)return next===engagement.next_refresh_at?engagement:{...engagement,next_refresh_at:next};
 const eligible=inventory.branches.filter(branch=>usable(branch.state)),ids=new Set(eligible.map(branch=>branch.branchId));
 const note=eligible.slice(0,3).map(branch=>`${branch.branchName??'Caja del negocio'}: ${branch.state==='available'?'comprobación reciente':'confirma disponibilidad en caja'}`).join('; ');
 return {...engagement,reward:{...engagement.reward,inventory},locations:engagement.locations.filter(location=>ids.has(location.branch_id)),
  conditions:`${engagement.conditions??''} Disponibilidad por sucursal: ${note}${eligible.length>3?'; consulta las demás sucursales en tu cuenta':''}. Las existencias pueden cambiar; no se reservan unidades.`,next_refresh_at:next};
}
