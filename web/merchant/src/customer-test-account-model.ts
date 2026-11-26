// "Cuenta de prueba" (docs/product/2026-11-23-owner-progress.md, note of 2026-11-26): the
// owner's own phone, a teammate's phone or a demo card. Marked accounts keep their points
// and history but are excluded from "Tu progreso", the basic report, activation insights
// and plan usage. Pure copy and helpers so the owner view and its tests share one source.
import type {Customer} from './owner-workspace';

export const TEST_ACCOUNT_LABEL = 'Cuenta de prueba';
export const TEST_ACCOUNT_EXPLANATION = 'Las cuentas de prueba (tu teléfono, el del equipo o una tarjeta de demostración) no cuentan en Tu progreso, el reporte básico, las métricas de activación ni el uso del plan. Sus puntos y movimientos se conservan.';

export function isTestAccount(customer: Pick<Customer, 'is_test'> | null | undefined) {return customer?.is_test === true;}
export function testAccountActionLabel(isTest: boolean) {return isTest ? 'Quitar marca de cuenta de prueba' : 'Marcar como cuenta de prueba';}
export function testAccountSavedMessage(isTest: boolean) {return isTest ? 'Cuenta marcada como de prueba. Ya no cuenta en el progreso ni en los reportes.' : 'La cuenta vuelve a contar como cliente real.';}
/** Request body for PATCH /api/admin/customers/:id/test-account; the server contract is strict. */
export function testAccountRequest(isTest: boolean): {is_test: boolean} {return {is_test: isTest};}
