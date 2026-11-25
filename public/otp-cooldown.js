// Resend cooldown shared by the customer card entry (customer-auth-entry.js) and the
// self-serve trial signup (trial-signup.js). The countdown is the only state; callers
// decide which buttons to disable and where the remaining seconds are shown.

/**
 * @param {{
 *   seconds: number,
 *   onTick: (secondsLeft: number) => void,
 *   onDone: () => void,
 *   now?: () => number,
 * }} options
 * @returns {() => void} stop the countdown without firing onDone
 */
export function createCooldown({ seconds, onTick, onDone, now = Date.now }) {
  const endsAt = now() + Math.max(0, seconds) * 1000;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    const left = Math.ceil((endsAt - now()) / 1000);
    if (left <= 0) {
      stop();
      onDone();
      return;
    }
    onTick(left);
  };
  timer = setInterval(tick, 1000);
  tick();
  return stop;
}

/** @param {number} secondsLeft */
export function cooldownLabel(secondsLeft) {
  return `Puedes reenviar en ${secondsLeft}s`;
}
