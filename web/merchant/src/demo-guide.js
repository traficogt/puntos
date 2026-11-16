import { hashForPage } from './navigation.js';

export const guideSteps = [
  { page: 'recovery', title: 'Encuentra a quién dar seguimiento', next: 'preparar una oferta',
    description: 'Cambia el plazo para encontrar clientes sin compras recientes. Más abajo puedes guardar una lista de prueba o revisar un seguimiento anterior. Sus compras posteriores son observaciones, no ventas atribuidas al contacto.' },
  { page: 'growth', title: 'Ponle límites a una oferta', next: 'revisar los costos',
    description: 'Elige una lista, un bono y un límite de puntos. La vista de costo usa tus supuestos; los resultados de las campañas de ejemplo se consultan más abajo. No son resultados de tu borrador ni una promesa de ventas.' },
  { page: 'economics', title: 'Entiende el costo de cumplir',
    description: 'Compara recompensas pendientes, costos registrados y escenarios de canje. Los importes estimados dependen de los costos que ingresa el negocio; no representan una obligación contable ni una previsión de ventas.' },
];

export function demoView(url) {
  const mode = url.searchParams.get('vista');
  return ['inicio', 'guia', 'libre'].includes(mode) ? mode : url.hash ? 'libre' : 'inicio';
}

export function demoLocation(url, page, mode) {
  const target = new URL(url);
  target.searchParams.set('vista', mode);
  target.hash = hashForPage(page);
  return target.pathname + target.search + target.hash;
}
