function minorAmount(value, minorUnits) {
  if (!['number', 'string'].includes(typeof value) || typeof value === 'string' && !value.trim() || ![0, 2].includes(minorUnits)) return null;
  const amount = Number(value), scaled = amount * (10 ** minorUnits), rounded = Math.round(scaled);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1000000 && Math.abs(scaled - rounded) < 0.000001 ? rounded : null;
}

// Use integer minor units: a partial item never consumes a partial ceiling.
export function hospitalityCapacity({units, budget, unitCost, minorUnits = 2}) {
  if (!Number.isInteger(units) || units < 1 || units > 10000) return null;
  const total = minorAmount(budget, minorUnits), perUnit = minorAmount(unitCost, minorUnits);
  if (total === null || perUnit === null) return null;
  const issuable = perUnit === 0 ? units : Math.min(units, Math.floor(total / perUnit));
  return {units: issuable, commitment: issuable * perUnit / (10 ** minorUnits)};
}

export function hospitalityPreset({knownCost, budget, minorUnits = 2}) {
  const capacity = hospitalityCapacity({units: 5, budget, unitCost: knownCost, minorUnits});
  return capacity?.units ? {totalUnits: capacity.units, totalCost: capacity.commitment, unitCostLimit: Number(knownCost)} : null;
}
