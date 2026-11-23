import { currencyPrecision, LIMITS } from "./model.js";
import { REGIONAL_CURRENCY_CODES } from "../regional-catalog.js";

/** Monthly starting reward budget; optional additional sales are separate from it. */
export function calculateSimple(input) {
  const errors = [];
  const precision = currencyPrecision(input.currency);
  /** @param {unknown} value @param {string} field @param {{optional?: boolean, places?: number, min?: number, max?: number}} [options] */
  function read(
    value,
    field,
    { optional = false, places = precision, min = 0, max = LIMITS.money } = {},
  ) {
    if (value === null || value === undefined) {
      if (!optional)
        errors.push({ field, message: "Escribe una cantidad. Si el costo es cero, escribe 0." });
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      errors.push({
        field,
        message: `Usa un número entre ${min} y ${max}, sin separadores de miles.`,
      });
      return null;
    }
    if (Math.round(value * 10 ** places) / 10 ** places !== value) {
      errors.push({
        field,
        message:
          places === 0
            ? "Usa un número entero, sin decimales."
            : `Usa como máximo ${places} decimales.`,
      });
      return null;
    }
    return value;
  }
  if (!REGIONAL_CURRENCY_CODES.includes(input.currency))
    errors.push({ field: "currency", message: "Elige una moneda de la lista." });
  const rewardCost = read(input.rewardCost, "rewardCost");
  const rewardCount = read(input.rewardCount, "rewardCount", { places: 0, max: LIMITS.units });
  const monthlyCosts = read(input.monthlyCosts, "monthlyCosts", { optional: true });
  let keptPerSale, rewardEvery, additionalSales;
  if (input.includeReturn) {
    keptPerSale = read(input.keptPerSale, "keptPerSale", { min: -LIMITS.money });
    rewardEvery = read(input.rewardEvery, "rewardEvery", { min: 1, places: 0, max: LIMITS.units });
    additionalSales = read(input.additionalSales, "additionalSales", {
      optional: true,
      places: 0,
      max: LIMITS.units,
    });
  }
  // A null amount here always comes with a recorded validation error.
  if (errors.length || rewardCost === null || rewardCount === null) return { errors };
  // Currency inputs are validated to minor units. Keep the per-purchase
  // division rational so cancellation cannot add a spurious whole purchase.
  const scale = BigInt(10 ** precision);
  const minor = (amount) => BigInt(Math.round(amount * Number(scale)));
  const costMinor = minor(rewardCost);
  const rewardBudgetMinor = costMinor * BigInt(rewardCount);
  const budgetMinor = rewardBudgetMinor + minor(monthlyCosts ?? 0);
  const rewardBudget = Number(rewardBudgetMinor) / Number(scale);
  const budget = Number(budgetMinor) / Number(scale);
  /** @type {{
   *   keptPerSale: number,
   *   rewardEvery: number,
   *   additionalSales: number | null,
   *   rewardReserve: number,
   *   availablePerSale: number,
   *   breakEven: number | null,
   *   balance: number | null,
   *   reason: "limit" | "nonpositive" | null,
   * } | null} */
  let estimate = null;
  const totals = [rewardBudget, budget];
  if (input.includeReturn) {
    const every = BigInt(rewardEvery);
    const keptMinor = minor(keptPerSale);
    const availableNumerator = keptMinor * every - costMinor;
    const denominator = scale * every;
    const rewardReserve = Number(costMinor) / Number(denominator);
    const availablePerSale = Number(availableNumerator) / Number(denominator);
    const threshold =
      budgetMinor === 0n
        ? 0n
        : availableNumerator > 0n
          ? (budgetMinor * every + availableNumerator - 1n) / availableNumerator
          : null;
    const tooLarge = threshold !== null && threshold > BigInt(LIMITS.total);
    const breakEven = threshold === null || tooLarge ? null : Number(threshold);
    const balance =
      additionalSales === null
        ? null
        : Number(BigInt(additionalSales) * availableNumerator - budgetMinor * every) /
          Number(denominator);
    estimate = {
      keptPerSale,
      rewardEvery,
      additionalSales,
      rewardReserve,
      availablePerSale,
      breakEven,
      balance,
      reason: tooLarge ? "limit" : availableNumerator <= 0n ? "nonpositive" : null,
    };
    if (additionalSales !== null && balance !== null)
      totals.push(additionalSales * keptPerSale, additionalSales * rewardReserve, balance);
  }
  if (totals.some((value) => !Number.isFinite(value) || Math.abs(value) > LIMITS.total)) {
    return {
      errors: [
        {
          field: "calculation",
          message: "El total es demasiado grande. Reduce las cantidades o los importes.",
        },
      ],
    };
  }
  return { errors, rewardBudget, budget, monthlyCosts, estimate };
}
