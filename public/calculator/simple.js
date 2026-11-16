import { calculateSimple } from './simple-model.js';
import { parseDecimal, formatMoney, currencyPrecision } from './model.js';
import { REGIONAL_CURRENCIES } from '../regional-catalog.js';

const byId = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('es-GT', { maximumFractionDigits: 6 }).format(value);
const value = id => parseDecimal(byId(id).value);
const examples = new Map([
  ['retail', { label: 'Tienda · accesorio de regalo', rewardCost: 20, rewardCount: 20, keptPerSale: 36, rewardEvery: 10, additionalSales: 20 }],
  ['salon', { label: 'Salón · tratamiento adicional', rewardCost: 12, rewardCount: 24, keptPerSale: 45, rewardEvery: 8, additionalSales: 10 }],
  ['carwash', { label: 'Lavado de vehículos · limpieza interior', rewardCost: 24, rewardCount: 16, keptPerSale: 36, rewardEvery: 8, additionalSales: 15 }],
  ['cafe', { label: 'Cafetería · bebida regular', rewardCost: 9, rewardCount: 40, keptPerSale: 20, rewardEvery: 6, additionalSales: 20 }],
]);
const labels = new Map([
  ['rewardCost', 'Costo del premio'], ['rewardCount', 'Cantidad de premios'], ['monthlyCosts', 'Otros gastos'],
  ['currency', 'Moneda'], ['keptPerSale', 'Lo que te queda de una compra'], ['rewardEvery', 'Compras por premio'],
  ['additionalSales', 'Compras extra'], ['calculation', 'Revisa las cantidades'],
]);
function inputs(includeReturn = false) {
  return { currency: byId('currency').value, rewardCost: value('rewardCost'), rewardCount: value('rewardCount'),
    monthlyCosts: value('monthlyCosts'), includeReturn, keptPerSale: value('keptPerSale'), rewardEvery: value('rewardEvery'), additionalSales: value('additionalSales') };
}
function money(amount) { return formatMoney(amount, byId('currency').value); }
function balanceAmount(amount) {
  const unit = 10 ** -currencyPrecision(byId('currency').value);
  return amount > 0 && amount < unit ? `menos de ${money(unit)}` : money(amount);
}
function syncCurrency() {
  for (const element of document.querySelectorAll('.currency-code')) element.textContent = `(${byId('currency').value})`;
}
function clearErrors() {
  for (const element of document.querySelectorAll('.field-error, .error-summary')) { element.hidden = true; element.replaceChildren(); }
  for (const element of document.querySelectorAll('[aria-invalid]')) element.removeAttribute('aria-invalid');
}
function showErrors(errors, scope) {
  const summary = byId(`${scope}-errors`);
  const intro = document.createElement('p'); intro.textContent = 'Revisa estos datos para continuar:';
  const list = document.createElement('ul');
  for (const error of errors) {
    const control = byId(error.field);
    const fieldError = byId(`${error.field}-error`);
    if (control) control.setAttribute('aria-invalid', 'true');
    if (fieldError) { fieldError.hidden = false; fieldError.textContent = error.message; }
    const row = document.createElement('li');
    const link = document.createElement('a'); link.href = `#${control ? error.field : 'rewardCount'}`;
    link.textContent = `${labels.get(error.field) || 'Datos'}: ${error.message}`;
    link.addEventListener('click', event => {
      event.preventDefault(); const target = control || byId('rewardCount');
      const details = target.closest('details'); if (details) details.open = true;
      target.focus();
    });
    row.append(link); list.append(row);
  }
  summary.replaceChildren(intro, list); summary.hidden = false; summary.focus();
}
function invalidateReturn() {
  byId('return-result').hidden = true; byId('print-assumptions').textContent = '';
  if (!byId('budget-result').hidden) {
    const input = inputs(); const result = calculateSimple(input);
    if (!result.errors.length) printAssumptions(input, result);
  }
}
function invalidateBudget() {
  byId('budget-result').hidden = true; byId('return-options').hidden = true; invalidateReturn();
}
function printAssumptions(input, result) {
  const lines = [`Período: un mes. Moneda: ${input.currency}. Sin conversión.`,
    `${number(input.rewardCount)} premios a ${money(input.rewardCost)} cada uno. Se contempla entregarlos todos.`,
    input.monthlyCosts === null ? 'Otros gastos no incluidos.' : `Otros gastos del mes: ${money(input.monthlyCosts)}.`];
  if (result.estimate) {
    lines.push(`Cada compra deja ${money(input.keptPerSale)} antes de premios. Un premio por cada ${number(input.rewardEvery)} compras.`,
      `Reserva por compra adicional: ${number(result.estimate.rewardReserve)} ${input.currency}. No cuentes esos premios también en el presupuesto inicial.`,
      input.additionalSales === null ? 'Sin hipótesis de compras adicionales.' : `Hipótesis: ${number(input.additionalSales)} compras adicionales.`,
      result.estimate.breakEven === null ? 'No hay un número calculable de compras que cubra este presupuesto.'
        : `${number(result.estimate.breakEven)} compras extra para cubrir el presupuesto.`,
      result.estimate.balance === null ? 'Sin saldo simulado.'
        : result.estimate.balance < 0 ? `Faltaría ${balanceAmount(-result.estimate.balance)} para cubrirlo.`
          : result.estimate.balance === 0 ? 'Se cubrirían exactamente los costos incluidos.'
            : `Quedaría ${balanceAmount(result.estimate.balance)} después de los costos incluidos.`,
      'No es una previsión de ventas ni un cálculo de utilidad neta.');
  }
  byId('print-assumptions').textContent = lines.join('\n');
}
function showBudget(focus = true) {
  clearErrors(); invalidateBudget();
  const input = inputs(); const result = calculateSimple(input);
  if (result.errors.length) { showErrors(result.errors, 'budget'); return; }
  byId('budget-total').textContent = money(result.budget);
  byId('budget-calculation').textContent = `${number(input.rewardCount)} premios × ${money(input.rewardCost)} cada uno${input.monthlyCosts === null ? '.' : ` + ${money(input.monthlyCosts)} en otros gastos.`}`;
  byId('budget-exclusions').textContent = input.monthlyCosts === null
    ? 'Solo premios: no incluye suscripción PF ni otros gastos. Puedes sumarlos arriba.'
    : 'Incluye todos estos premios y los otros gastos que anotaste. Revisa que no falte ninguno.';
  byId('budget-result').hidden = false; byId('return-options').hidden = false;
  printAssumptions(input, result);
  if (focus) byId('budget-heading').focus();
}
function showReturn() {
  clearErrors(); invalidateReturn();
  const input = inputs(true); const result = calculateSimple(input);
  if (result.errors.length) { showErrors(result.errors, 'return'); return; }
  const estimate = result.estimate;
  byId('extra-sales-needed').textContent = result.budget === 0 ? 'Este presupuesto no requiere compras extra.'
    : estimate.reason === 'nonpositive' ? 'Con esos números, cada compra extra no alcanza para cubrir el premio que genera.'
      : estimate.reason === 'limit' ? 'El número de compras sería demasiado alto. Revisa el premio y los costos.'
        : `${number(estimate.breakEven)} ${estimate.breakEven === 1 ? 'compra extra' : 'compras extra'} para cubrir este presupuesto.`;
  byId('sales-scenario').hidden = estimate.balance === null;
  if (estimate.balance !== null) {
    const beginning = `Con ${number(input.additionalSales)} ${input.additionalSales === 1 ? 'compra extra' : 'compras extra'}, `;
    byId('sales-scenario').textContent = beginning + (estimate.balance < 0
      ? `faltarían ${balanceAmount(-estimate.balance)} para cubrirlo.`
      : estimate.balance === 0 ? 'cubrirías exactamente los costos incluidos.'
        : `quedarían ${balanceAmount(estimate.balance)} después de los premios y gastos incluidos.`);
  }
  byId('return-explanation').textContent = 'También incluimos los premios que ganarían esas compras adicionales. No los cuentes otra vez en tu presupuesto inicial.';
  byId('return-result').hidden = false; printAssumptions(input, result); byId('return-result').focus();
}
function clearForms() {
  byId('budget-form').reset(); byId('return-form').reset(); byId('currency').value = 'GTQ';
  byId('extra-costs').open = false; byId('return-options').open = false;
  byId('example-context').hidden = true; clearErrors(); invalidateBudget(); syncCurrency();
}
for (const [code, name] of Object.entries(REGIONAL_CURRENCIES)) {
  const option = document.createElement('option'); option.value = code; option.textContent = `${code} · ${name}`; byId('currency').append(option);
}
byId('budget-form').addEventListener('submit', event => { event.preventDefault(); showBudget(); });
byId('return-form').addEventListener('submit', event => { event.preventDefault(); showReturn(); });
byId('budget-form').addEventListener('input', invalidateBudget);
byId('budget-form').addEventListener('change', () => { syncCurrency(); invalidateBudget(); });
byId('return-form').addEventListener('input', invalidateReturn);
byId('return-form').addEventListener('change', invalidateReturn);
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    const example = examples.get(button.dataset.example); if (!example) return;
    clearForms();
    for (const [key, val] of Object.entries(example)) { if (key !== 'label') byId(key).value = String(val); }
    byId('example-context').textContent = `Ejemplo ficticio: ${example.label}. Cifras en GTQ, editables; no son costos típicos ni tarifas de PF. Se supone capacidad disponible para los servicios.`;
    byId('example-context').hidden = false; showBudget(false);
  });
}
byId('reset-simple').addEventListener('click', () => { clearForms(); byId('examples').open = false; byId('rewardCost').focus(); });
byId('print-simple').addEventListener('click', () => window.print());
clearForms(); byId('simple-calculator').hidden = false;
