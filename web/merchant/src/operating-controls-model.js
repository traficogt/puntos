// Pure helpers for the "Ritmo del negocio" controls. A null capacity means
// "sin límite"; an empty field is never coerced to zero.

/** @param {number | null | undefined} serverCapacity @returns {number | string} */
export function capacityField(serverCapacity) {
  return Number.isInteger(serverCapacity) ? serverCapacity : '';
}

const isEmpty = value => value === '' || value === null || value === undefined || (typeof value === 'string' && !value.trim());

/**
 * @param {number | string | null | undefined} value
 * @returns {{ok: true, value: number | null} | {ok: false, message: string}}
 */
export function capacityChoice(value) {
  if (isEmpty(value)) return { ok: true, value: null };
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 200) return { ok: false, message: 'Indica una capacidad entera de 1 a 200 bonos, o deja el campo vacío para no fijar un límite.' };
  return { ok: true, value: number };
}

/**
 * Builds the operating-mode body. Capacity is sent only when the owner changed
 * it relative to the server value; clearing the field sends an explicit null.
 * @param {{mode: string, minutes: number | string, capacity: number | string | null | undefined, current: {capacity?: number | null, version: string}}} input
 * @returns {{ok: boolean, body?: Record<string, any>, message?: string}}
 */
export function operatingModeBody({ mode, minutes, capacity, current }) {
  const serverCapacity = Number.isInteger(current?.capacity) ? current.capacity : null;
  // An unchanged stored value (including an older 0) is not re-validated or resent.
  const unchanged = isEmpty(capacity) ? serverCapacity === null : serverCapacity !== null && Number(capacity) === serverCapacity;
  const choice = unchanged ? { ok: true, value: serverCapacity } : capacityChoice(capacity);
  if (!choice.ok) return choice;
  return {
    ok: true,
    body: {
      mode,
      version: current.version,
      ...(unchanged ? {} : { capacity: choice.value }),
      ...(mode === 'normal' ? {} : { minutes: Number(minutes) })
    }
  };
}

/** Template approvals need an explicit capacity; "sin límite" cannot be approved. */
export function approvalCapacity(value) {
  const choice = capacityChoice(value);
  return choice.ok && choice.value !== null ? choice.value : null;
}
