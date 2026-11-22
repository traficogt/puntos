// Single source of truth for the demo catalog's recurring example rewards, and the
// industry themes that let a prospect preview the sandbox in their own vertical.
//
// Why this exists:
//  1. Before this module every demo page hardcoded its own reward name + points and
//     they drifted ("Café de la casa" showed 50/80/100; "Postre del día" 75/80/100).
//  2. The demo was café-only, so a salon or taller owner saw nothing that looked like
//     their business. Points belong to the SLOT (stable across verticals); only the
//     NAME changes per theme, so every page shows the same points for the same slot in
//     every vertical, and switching vertical never re-introduces number drift.
//
// Café is the default, so existing behavior and tests are unchanged. Other verticals
// are opt-in via `?ejemplo=<key>` on the demo URL (the sandbox reads it once at load;
// the theme selector reloads to re-apply). Extend THEMES with more verticals freely.

const SLOTS = {
  coffee:  { points: 50, desc: 'Tu recompensa más popular para clientes frecuentes.' },
  dessert: { points: 80, desc: 'Un detalle para quienes vuelven seguido.' },
  tea:     { points: 80, desc: null },
  bread:   { points: 80, desc: null },
  upgrade: { points: 25, desc: null },
};

export const DEMO_THEMES = {
  cafe: {
    label: 'Cafetería',
    coffee: 'Café de la casa', dessert: 'Postre del día',
    tea: 'Té de la casa', bread: 'Pan artesanal', upgrade: 'Tamaño grande',
  },
  salon: {
    label: 'Salón de belleza',
    coffee: 'Lavado y peinado', dessert: 'Tratamiento capilar',
    tea: 'Manicura exprés', bread: 'Diseño de cejas', upgrade: 'Mascarilla hidratante',
  },
  taller: {
    label: 'Taller mecánico',
    coffee: 'Cambio de aceite', dessert: 'Alineación y balanceo',
    tea: 'Lavado premium', bread: 'Revisión de frenos', upgrade: 'Ambientador premium',
  },
};

const DEFAULT_THEME = 'cafe';

function readTheme() {
  try {
    if (typeof location === 'undefined') return DEFAULT_THEME;
    const key = new URLSearchParams(location.search).get('ejemplo');
    return key && Object.prototype.hasOwnProperty.call(DEMO_THEMES, key) ? key : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

let active = readTheme();

/** Switch the active demo vertical. Module-level demo data is built at import, so a
 *  live selector reloads the page to re-read the theme; this setter exists for tests
 *  and any future in-place renderer. */
export function setDemoTheme(key) { if (Object.prototype.hasOwnProperty.call(DEMO_THEMES, key)) active = key; return active; }
export function demoThemeKey() { return active; }
export const demoThemeOptions = Object.entries(DEMO_THEMES).map(([value, t]) => ({ value, label: t.label }));

function slot(name) {
  return { name: DEMO_THEMES[active][name], points_cost: SLOTS[name].points, description: SLOTS[name].desc };
}

// Theme-aware accessor. Pages use DEMO_CATALOG.coffee.name / .points_cost / .description;
// the proxy resolves each slot against the active theme at access time (which, for
// module-level demo data, is import time — see setDemoTheme).
/**
 * Demo catalog keyed by item id. Typed explicitly so consumers (demo-api, demo-economics, demo-growth, ...)
 * can index it by name under checkJs; the values are plain synthetic data.
 * @type {Record<string, { name: string, description?: string, points_cost?: number, [extra: string]: unknown }>}
 */
export const DEMO_CATALOG = new Proxy({}, {
  get(_t, key) { return typeof key === 'string' && key in SLOTS ? slot(key) : undefined; },
  has(_t, key) { return typeof key === 'string' && key in SLOTS; },
  ownKeys() { return Object.keys(SLOTS); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});
