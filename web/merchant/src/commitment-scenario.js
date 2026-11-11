export function commitmentScenario({available,pending,costPerPoint,percent}){
 if(![available,pending].every(value=>Number.isSafeInteger(value)&&value>=0)||!Number.isFinite(percent)||percent<0||percent>100||costPerPoint!==null&&(!Number.isFinite(costPerPoint)||costPerPoint<0||costPerPoint>1000))return null;
 const availablePoints=Math.floor(available*percent/100),pendingPoints=Math.floor(pending*percent/100),cost=points=>costPerPoint===null?null:Math.round(points*costPerPoint*100)/100;
 return{availablePoints,pendingPoints,availableCost:cost(availablePoints),pendingCost:cost(pendingPoints)};
}
