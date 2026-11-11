/**
 * @typedef {import("../types.js").CustomerReward & {stock?: number | null, valid_until?: string | null, active?: boolean}} CustomerReward
 */

/** @param {import("../types.js").CustomerRewardInventoryBranch} branch @param {number} now */
function inventoryState(branch,now){
 if(branch.state!=='available')return branch.state;
 const until=Date.parse(branch.freshUntil??''),observed=Date.parse(branch.observedAt??'');
 if(!Number.isFinite(until)||!Number.isFinite(observed)||observed>now)return 'unknown';
 return now>until?'stale':'available';
}
/** @param {import("../types.js").CustomerRewardInventory | undefined} inventory @param {number} now */
function inventoryView(inventory,now){
 if(!inventory)return {available:true,label:'',note:''};
 const branches=Array.isArray(inventory.branches)?inventory.branches:[];
 const states=branches.map(branch=>inventoryState(branch,now));
 const available=states.some(state=>state==='available'||state==='not_required');
 const stale=states.includes('stale')||inventory.state==='stale';
 const empty=states.length?states.every(state=>state==='unavailable'):inventory.state==='unavailable';
 const label=available?'':empty?'Artículo sin existencias suficientes':stale?'Comprobación de existencias desactualizada':'Disponibilidad por confirmar en caja';
 const notes=branches.map((branch,index)=>{
  const state=states[index];
  const description=state==='available'?'existencias comprobadas recientemente':state==='not_required'?'confirma disponibilidad en caja':state==='stale'?'comprobación desactualizada':state==='unavailable'?'sin existencias suficientes':'sin comprobación reciente';
  const time=state==='available'&&branch.observedAt?` (${new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short'}).format(new Date(branch.observedAt))})`:'';
  return `${branch.branchName||'Caja del negocio'}: ${description}${time}.`;
 });
 return {available,label,note:[...notes,'Las existencias pueden cambiar; no se reservan unidades.'].join(' ')};
}
/** @param {CustomerReward[] | undefined} rewards @param {number} [now] */
export function nextInventoryRefresh(rewards,now=Date.now()){
 const deadlines=(rewards??[]).flatMap(reward=>[Date.parse(reward.valid_until??''),...(reward.inventory?.branches??[]).filter(branch=>branch.state==='available').map(branch=>Date.parse(branch.freshUntil??'')+1)]).filter(at=>Number.isFinite(at)&&at>now);
 return deadlines.length?Math.min(...deadlines):null;
}

/**
 * @param {number} points
 * @param {CustomerReward} reward
 */
export function getRewardViewModel(points, reward, now=Date.now()) {
  const normalizedPoints = Number(points || 0);
  const cost = Number(reward?.points_cost || 0);
  const remainingPoints = Math.max(0, cost - normalizedPoints);
  const inventory=inventoryView(reward?.inventory,now);
  const unavailable = reward?.active === false ? "Recompensa no disponible"
    : !inventory.available ? inventory.label
    : reward?.available === false ? "Entrega temporalmente no disponible"
    : reward?.stock != null && Number(reward.stock) <= 0 ? "Recompensa agotada"
      : reward?.valid_until && Date.parse(reward.valid_until) <= now ? "Recompensa vencida"
        : !Number.isFinite(cost) || cost < 0 ? "Recompensa no disponible" : "";
  const available = !unavailable;
  const canRedeem = available && remainingPoints === 0;

  return {
    reward,
    canRedeem,
    available,
    remainingPoints,
    inventoryNote:inventory.note,
    statusLabel: unavailable || (canRedeem
      ? "Tienes los puntos necesarios"
      : `Te faltan ${remainingPoints} puntos para canjear`)
  };
}

/**
 * @param {number} points
 * @param {CustomerReward[] | undefined} rewards
 */
export function rewardsWithState(points, rewards, now=Date.now()) {
  const sorted = [...(rewards || [])]
    .map((reward) => getRewardViewModel(points, reward, now))
    .sort((a, b) => {
      if (a.canRedeem !== b.canRedeem) return a.canRedeem ? -1 : 1;
      return Number(a.reward.points_cost || 0) - Number(b.reward.points_cost || 0);
    });

  const eligible = sorted.filter((entry) => entry.canRedeem);
  const next = sorted.find(entry => entry.available)?.reward || null;
  const remain = next ? Math.max(0, Number(next.points_cost || 0) - Number(points || 0)) : 0;

  return { sorted, eligible, next, remain };
}
