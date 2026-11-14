export const defaultMeasurementPlan = { baseline_return_rate_pct:30, minimum_detectable_lift_pp:10, observation_days:30, reconciliation_days:7 };
export function measurementPlanInput(values, availableMembers) {
 const plan=values.measurement_plan, duration=Number(values.duration_days), holdout=Number(values.holdout_percent);
 if(!plan || ![7,14,30].includes(duration) || ![10,20,30,50].includes(holdout))return null;
 const {baseline_return_rate_pct:baseline,minimum_detectable_lift_pp:lift,observation_days:days,reconciliation_days:reconciliation}=plan;
 if(!Number.isFinite(baseline)||baseline<1||baseline>95||!Number.isFinite(lift)||lift<=0||lift>50||baseline+lift>=100||!Number.isInteger(days)||days<duration||days>180||!Number.isInteger(reconciliation)||reconciliation<0||reconciliation>30)return null;
 return {measurement_plan:{...plan},duration_days:duration,holdout_percent:holdout,available_members:Number.isInteger(availableMembers)&&availableMembers>=0?availableMembers:null};
}
export const measurementCostKeys=['gross_margin_pct','fulfillment_cost_q','messaging_cost_q','other_cost_q','outstanding_reward_cost_q'];
export function measurementCostInput(values) {
 const out={};
 for(const key of measurementCostKeys){const v=values[key];out[key]=v===''||v==null?null:v;if(out[key]!==null&&(!Number.isFinite(v)||v<0||(key==='gross_margin_pct'?v>100:v>999999999.99||Math.abs(v*100-Math.round(v*100))>0.00001)))throw new Error('Revisa el margen y los costos: usa montos no negativos y un margen de 0 a 100%.');}
 out.notes=String(values.notes??'').trim();if(out.notes.length>1000)throw new Error('Las notas deben tener hasta 1,000 caracteres.');return out;
}
