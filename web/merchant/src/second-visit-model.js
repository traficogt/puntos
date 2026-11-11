export function secondVisitCommitment(settings,costPerPoint){
 const bonus=Number(settings.bonus_points),cap=Number(settings.monthly_points_cap),offerCap=Number(settings.monthly_offer_cap);
 const offers=bonus>0?Math.max(0,Math.min(Math.floor(cap/bonus),offerCap)):0,points=offers*bonus;
 return{offers,points,cost:costPerPoint==null?null:Math.round(points*Number(costPerPoint)*100)/100};
}
