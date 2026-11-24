/**
 * Reward and rule configuration a rehearsal replays; the server snapshots it when the practice
 * starts so later catalogue changes cannot alter the outcome.
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   points_cost: number,
 *   active?: boolean,
 *   available?: boolean,
 *   stock?: number | null,
 *   branch_ids?: string[] | null,
 *   valid_until?: string | null,
 * }} RehearsalReward
 * @typedef {{
 *   program_type: string,
 *   program_json?: { points_per_q?: number, points_per_visit?: number, points_per_item?: number, round?: string } | null,
 *   branch_id?: string | null,
 *   observed_at?: string | null,
 *   rewards: RehearsalReward[],
 * }} RehearsalConfig
 * @typedef {{ action: string, outcome: string, points: number, reward_id?: string, quantity?: unknown }} RehearsalHistoryEntry
 * @typedef {{
 *   config: RehearsalConfig,
 *   signed_up: boolean,
 *   points: number,
 *   redemption: { reward_id: string, points: number } | null,
 *   unlocked: string[],
 *   history: RehearsalHistoryEntry[],
 *   complete: boolean,
 * }} RehearsalState
 * @typedef {{ action?: string, rewardId?: string | null, quantity?: unknown }} RehearsalInput
 */
/** @param {string} message */
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
/** @param {string} message */
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });
/**
 * @param {RehearsalConfig} config
 * @returns {RehearsalState}
 */
export function initialRehearsal(config) {
  return {
    config: structuredClone(config),
    signed_up: false,
    points: 0,
    redemption: null,
    unlocked: [],
    history: [],
    complete: false,
  };
}
/**
 * @param {RehearsalState} previous
 * @param {RehearsalInput} input
 * @returns {RehearsalState}
 */
export function applyRehearsalAction(previous, input) {
  const state = structuredClone(previous),
    action = input.action,
    config = state.config;
  if (
    !action ||
    !["signup", "earn", "ineligibility", "unlock", "redeem", "refund"].includes(action)
  )
    throw badRequest("Selecciona un paso de la práctica.");
  if (action !== "signup" && !state.signed_up)
    throw badRequest("Completa la inscripción ficticia primero.");
  const reward = config.rewards.find((row) => row.id === input.rewardId);
  const eligibility = () =>
    !reward
      ? "missing_reward"
      : reward.active === false || reward.available === false
        ? "unavailable"
        : reward.stock != null && reward.stock <= 0
          ? "out_of_stock"
          : reward.branch_ids?.length &&
              !(
                /** @type {ReadonlyArray<string | null | undefined>} */ (
                  reward.branch_ids
                ).includes(config.branch_id)
              )
            ? "wrong_branch"
            : reward.valid_until &&
                new Date(reward.valid_until) <= new Date(config.observed_at ?? Date.now())
              ? "expired"
              : state.points < Number(reward.points_cost)
                ? "insufficient_points"
                : null;
  let outcome = "completed",
    points = 0;
  if (action === "signup") {
    if (state.signed_up) throw conflict("La inscripción ficticia ya está registrada.");
    state.signed_up = true;
  }
  if (action === "earn") {
    /** @type {NonNullable<RehearsalConfig["program_json"]>} */
    const cfg = config.program_json ?? {};
    const program = {
        program_type: config.program_type,
        rate: Number(
          config.program_type === "SPEND"
            ? (cfg.points_per_q ?? 0)
            : config.program_type === "VISIT"
              ? (cfg.points_per_visit ?? 0)
              : (cfg.points_per_item ?? 0),
        ),
        round: cfg.round ?? "ceil",
      },
      quantity = input.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000 ||
      (program.program_type !== "SPEND" && !Number.isSafeInteger(quantity)) ||
      !program.rate ||
      program.rate < 0
    )
      throw badRequest("Revisa la cantidad y la regla guardada.");
    /** @type {Record<string, (x: number) => number>} */
    const rounding = { floor: Math.floor, round: Math.round, ceil: Math.ceil };
    points = (rounding[program.round] ?? Math.ceil)(quantity * program.rate);
    if (!Number.isSafeInteger(points) || points < 1 || state.points + points > 2147483647)
      throw badRequest("La compra ficticia no produce puntos válidos.");
    state.points += points;
  }
  if (["unlock", "redeem", "ineligibility"].includes(action)) {
    if (!reward) throw badRequest("Selecciona una recompensa de la configuración guardada.");
    const failure = eligibility();
    if (action === "ineligibility") {
      if (!failure)
        throw badRequest(
          "Este cliente ficticio sí es elegible. Prueba una recompensa sin puntos suficientes o no disponible.",
        );
      outcome = failure;
    } else {
      if (failure)
        throw conflict(
          /** @type {Record<string, string>} */ ({
            insufficient_points: "Faltan puntos ficticios.",
            wrong_branch: "La recompensa corresponde a otra sucursal.",
            out_of_stock: "No hay existencias.",
          })[failure] ?? "La recompensa no está disponible.",
        );
      if (action === "unlock") {
        if (!state.unlocked.includes(reward.id)) state.unlocked.push(reward.id);
      } else {
        if (state.redemption) throw conflict("Devuelve el canje ficticio antes de otro canje.");
        if (!state.unlocked.includes(reward.id))
          throw badRequest("Comprueba primero el desbloqueo de la recompensa.");
        points = Number(reward.points_cost);
        state.points -= points;
        state.redemption = { reward_id: reward.id, points };
      }
    }
  }
  if (action === "refund") {
    if (!state.redemption) throw badRequest("Registra primero un canje ficticio.");
    points = state.redemption.points;
    state.points += points;
    state.redemption = null;
  }
  state.history.push({
    action,
    outcome,
    points,
    ...(reward ? { reward_id: reward.id } : {}),
    ...(action === "earn" ? { quantity: input.quantity } : {}),
  });
  state.complete = ["signup", "earn", "ineligibility", "unlock", "redeem", "refund"].every((step) =>
    state.history.some((row) => row.action === step),
  );
  return state;
}
