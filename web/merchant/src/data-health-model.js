// Pure helpers for the data-health settings form.

/** @param {unknown} value @returns {number | null} */
export function expectedMinutes(value) {
  if (value === '' || value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= 5 && number <= 10080 ? number : null;
}

/**
 * Builds the PUT body. An empty or invalid deadline is never sent as ''.
 * @param {string} version
 * @param {Array<{id: string, source: string, label: string, branch_id: string | null, expected_minutes: unknown, enabled: boolean}>} sources
 * @returns {{ok: boolean, body?: {version: string, sources: any[]}, message?: string}}
 */
export function dataHealthBody(version, sources) {
  const normalized = [];
  for (const source of sources) {
    const minutes = expectedMinutes(source.expected_minutes);
    if (minutes === null) return { ok: false, message: `Indica en «${source.label || source.source}» un plazo entero de 5 a 10080 minutos antes de guardar.` };
    normalized.push({ ...source, expected_minutes: minutes });
  }
  return { ok: true, body: { version, sources: normalized } };
}

/** @param {{status?: number, message?: string} | null | undefined} error @param {{refreshed?: boolean}} [options] */
export function saveErrorMessage(error, { refreshed = false } = {}) {
  if (error?.status === 409) return refreshed
    ? 'La configuración cambió en otra sesión. Conservamos tus cambios en el formulario: revísalos y vuelve a guardar.'
    : `${error.message || 'La configuración cambió en otra sesión.'} Tus cambios siguen en el formulario.`;
  if (error?.status) return error.message || 'No pudimos guardar el seguimiento.';
  return 'No pudimos guardar el seguimiento. Revisa tu conexión e inténtalo de nuevo; tus cambios siguen en el formulario.';
}
