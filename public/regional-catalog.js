// Shared by server, website settings and demo. Operational currencies; no FX conversion.
export const REGIONAL_COUNTRIES = Object.freeze({
  GT: { name: 'Guatemala', currency: 'GTQ', timezone: 'America/Guatemala', locale: 'es-GT', dialCode: '502' },
  BZ: { name: 'Belice', currency: 'BZD', timezone: 'America/Belize', locale: 'es-BZ', dialCode: '501' },
  SV: { name: 'El Salvador', currency: 'USD', timezone: 'America/El_Salvador', locale: 'es-SV', dialCode: '503' },
  HN: { name: 'Honduras', currency: 'HNL', timezone: 'America/Tegucigalpa', locale: 'es-HN', dialCode: '504' },
  NI: { name: 'Nicaragua', currency: 'NIO', timezone: 'America/Managua', locale: 'es-NI', dialCode: '505' },
  CR: { name: 'Costa Rica', currency: 'CRC', timezone: 'America/Costa_Rica', locale: 'es-CR', dialCode: '506' },
  PA: { name: 'Panamá', currency: 'USD', timezone: 'America/Panama', locale: 'es-PA', dialCode: '507' },
  MX: { name: 'México', currency: 'MXN', timezone: 'America/Mexico_City', locale: 'es-MX', dialCode: '52' },
  CO: { name: 'Colombia', currency: 'COP', timezone: 'America/Bogota', locale: 'es-CO', dialCode: '57' },
  PE: { name: 'Perú', currency: 'PEN', timezone: 'America/Lima', locale: 'es-PE', dialCode: '51' },
  CL: { name: 'Chile', currency: 'CLP', timezone: 'America/Santiago', locale: 'es-CL', dialCode: '56' },
  DO: { name: 'República Dominicana', currency: 'DOP', timezone: 'America/Santo_Domingo', locale: 'es-DO', dialCode: '1' },
  EC: { name: 'Ecuador', currency: 'USD', timezone: 'America/Guayaquil', locale: 'es-EC', dialCode: '593' },
  US: { name: 'Estados Unidos', currency: 'USD', timezone: 'America/New_York', locale: 'es-US', dialCode: '1' },
});
export const REGIONAL_CURRENCIES = Object.freeze({
  GTQ: 'Quetzal', BZD: 'Dólar beliceño', USD: 'Dólar estadounidense', HNL: 'Lempira',
  NIO: 'Córdoba nicaragüense', CRC: 'Colón costarricense', PAB: 'Balboa',
  MXN: 'Peso mexicano', COP: 'Peso colombiano', PEN: 'Sol', CLP: 'Peso chileno', DOP: 'Peso dominicano',
});
export const REGIONAL_CURRENCY_CODES = Object.freeze(Object.keys(REGIONAL_CURRENCIES));
