import { calculateLoyalty, parseDecimal, formatMoney, LIMITS } from './model.js';
import { REGIONAL_CURRENCIES } from '../regional-catalog.js';

const byId = id => document.getElementById(id);
const form = /** @type {HTMLFormElement} */ (byId('calculator-form'));
const number = value => new Intl.NumberFormat('es-GT', { maximumFractionDigits: 6 }).format(value);
const input = id => /** @type {HTMLInputElement} */ (byId(id));
const value = id => parseDecimal(input(id).value);
let rewardCount = 0;
let lastReport = '';
let exampleLabel = '';

const examples = {
  retail: { name: 'Tienda', note: 'Un artículo y un descuento. La reserva de 3 por compra combina 20 ÷ 10 compras y 5 ÷ 5 compras.',
    rewards: [{ name: 'Accesorio de regalo', kind: 'product', units: 20, unitCost: 20, retailPrice: 55 }, { name: 'Descuento de 5', kind: 'discount', units: 30, unitCost: 5 }],
    operations: 90, average: 120, marginPercent: 30, additional: 30, rewardAllowance: 3 },
  salon: { name: 'Salón', note: 'Un tratamiento adicional que cuesta 12 y desplaza contribución de 8. Un premio cada 8 compras requiere reservar (12 + 8) ÷ 8 = 2.5 por compra.',
    rewards: [{ name: 'Tratamiento adicional', kind: 'service', units: 24, unitCost: 12, opportunityCost: 8, retailPrice: 45 }],
    operations: 60, average: 100, marginPercent: 45, additional: 20, rewardAllowance: 2.5 },
  carwash: { name: 'Lavado de vehículos', note: 'Un servicio con costo de 24, en capacidad disponible: costo de oportunidad confirmado en 0. Un premio cada 8 compras requiere reservar 24 ÷ 8 = 3 por compra.',
    rewards: [{ name: 'Limpieza interior', kind: 'service', units: 16, unitCost: 24, opportunityCost: 0, retailPrice: 70 }],
    operations: 80, average: 90, marginPercent: 40, additional: 18, rewardAllowance: 3 },
  cafe: { name: 'Cafetería', note: 'Una bebida que cuesta 9 entregar. Un premio cada 6 compras requiere reservar 9 ÷ 6 = 1.5 por compra.',
    rewards: [{ name: 'Bebida regular', kind: 'product', units: 40, unitCost: 9, retailPrice: 30 }],
    operations: 40, average: 40, marginPercent: 50, additional: 25, rewardAllowance: 1.5 },
};

function blankReward() { return { name: '', kind: 'product', units: '', unitCost: '', retailPrice: '', opportunityCost: '' }; }
function rawRewards() {
  return Array.from({ length: rewardCount }, (_, index) => Object.fromEntries(
    ['name', 'kind', 'units', 'unitCost', 'retailPrice', 'opportunityCost'].map(key => [key, input(`reward-${index}-${key}`).value])));
}
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function field(id, labelText, help = '', mode = 'decimal', currency = false) {
  const wrapper = element('div', 'field');
  const label = element('label', '', labelText); label.setAttribute('for', id);
  if (currency) label.append(document.createTextNode(' '), element('span', 'currency-code'));
  const control = element('input'); control.id = id;
  control.setAttribute('type', 'text'); control.setAttribute('inputmode', mode); control.setAttribute('maxlength', '24');
  control.setAttribute('aria-describedby', `${id}-help ${id}-error`);
  const hint = element('p', 'field-help', help); hint.id = `${id}-help`;
  const error = element('p', 'field-error'); error.id = `${id}-error`; error.hidden = true;
  wrapper.append(label, control, hint, error);
  return wrapper;
}
function renderRewards(rewards) {
  byId('rewards').replaceChildren();
  rewardCount = rewards.length;
  rewards.forEach((reward, index) => {
    const prefix = `reward-${index}`;
    const section = document.createElement('section');
    section.className = 'reward';
    section.setAttribute('aria-labelledby', `${prefix}-title`);
    const header = element('div', 'reward-header');
    const heading = element('h3', '', `Premio ${index + 1}`); heading.id = `${prefix}-title`;
    const remove = element('button', 'text-button', 'Quitar'); remove.setAttribute('type', 'button'); remove.dataset.remove = String(index);
    remove.setAttribute('aria-label', `Quitar premio ${index + 1}`); remove.hidden = rewards.length === 1;
    header.append(heading, remove);
    const grid = element('div', 'reward-grid');
    const nameField = element('div', 'field reward-name');
    const nameLabel = element('label', '', 'Nombre del premio '); nameLabel.setAttribute('for', `${prefix}-name`); nameLabel.append(element('span', 'optional', '(opcional)'));
    const nameInput = element('input'); nameInput.id = `${prefix}-name`; nameInput.setAttribute('type', 'text'); nameInput.setAttribute('maxlength', '80'); nameInput.setAttribute('autocomplete', 'off');
    nameField.append(nameLabel, nameInput);
    const typeField = element('div', 'field reward-type');
    const typeLabel = element('label', '', 'Tipo'); typeLabel.setAttribute('for', `${prefix}-kind`);
    const select = element('select'); select.id = `${prefix}-kind`;
    for (const [key, title] of [['product', 'Producto'], ['service', 'Servicio'], ['discount', 'Descuento']]) {
      const option = element('option', '', title); option.setAttribute('value', key); select.append(option);
    }
    typeField.append(typeLabel, select);
    grid.append(nameField, typeField,
      field(`${prefix}-units`, 'Unidades del mes', 'Premios completos. De 0 a 1,000,000.', 'numeric'),
      field(`${prefix}-unitCost`, 'Costo por unidad', 'En blanco: sin dato. Un 0 escrito confirma costo cero.', 'decimal', true));
    const note = element('p', 'reward-kind-note'); note.id = `${prefix}-kind-note`;
    const details = element('details'); details.id = `${prefix}-details`;
    const detailGrid = element('div', 'form-grid');
    const opportunity = element('div'); opportunity.id = `${prefix}-opportunity-field`;
    opportunity.append(field(`${prefix}-opportunityCost`, 'Contribución perdida por unidad', 'Si este servicio desplaza una venta, agrega lo que habría quedado de ella tras sus costos variables. En blanco se excluye; 0 confirma capacidad disponible.', 'decimal', true));
    detailGrid.append(field(`${prefix}-retailPrice`, 'Precio habitual de venta', 'Solo referencia: no se resta como costo ni se suma como ingreso.', 'decimal', true), opportunity);
    details.append(element('summary', '', 'Precio habitual y capacidad (opcionales)'), detailGrid);
    section.append(header, grid, note, details);
    byId('rewards').append(section);
    for (const key of ['name', 'kind', 'units', 'unitCost', 'retailPrice', 'opportunityCost']) input(`${prefix}-${key}`).value = String(reward[key] ?? '');
    input(`${prefix}-kind`).addEventListener('change', () => syncRewardKind(index));
    section.querySelector('[data-remove]').addEventListener('click', () => {
      const remaining = rawRewards().filter((_, position) => position !== index);
      renderRewards(remaining);
      markChanged();
      input(`reward-${Math.min(index, remaining.length - 1)}-name`).focus();
    });
    syncRewardKind(index);
  });
  /** @type {HTMLButtonElement} */ (byId('add-reward')).disabled = rewards.length >= LIMITS.rewards;
  syncCurrency();
}
function syncRewardKind(index) {
  const prefix = `reward-${index}`;
  const kind = input(`${prefix}-kind`).value;
  const label = document.querySelector(`label[for="${prefix}-unitCost"]`);
  label.replaceChildren(document.createTextNode(`${kind === 'discount' ? 'Descuento por canje' : 'Costo de entregar una unidad'} `), element('span', 'currency-code'));
  byId(`${prefix}-details`).hidden = kind === 'discount';
  byId(`${prefix}-opportunity-field`).hidden = kind !== 'service';
  byId(`${prefix}-kind-note`).textContent = kind === 'discount'
    ? 'Usa el importe fijo que dejas de cobrar por canje. Para un porcentaje, conviértelo a un importe por compra. Se resta una sola vez: no vuelvas a descontarlo del importe medio del paso 3.'
    : kind === 'service' ? 'Incluye el trabajo adicional y los insumos. Si ocupas un horario que habrías vendido, puedes anotar la contribución perdida en la opción de capacidad.'
      : 'Incluye materiales, empaque y otros gastos que aumentan al entregar este producto.';
  syncCurrency();
}
function syncCurrency() {
  document.querySelectorAll('.currency-code').forEach(element => { element.textContent = `(${input('currency').value})`; });
}
function syncPurchase() {
  byId('margin-field').hidden = input('marginMode').value !== 'margin';
  byId('variable-field').hidden = input('marginMode').value !== 'variable';
  byId('allowance-field').hidden = input('allowanceMode').value !== 'amount';
}
function readScenario() {
  return {
    currency: input('currency').value,
    rewards: rawRewards().map(reward => ({ name: reward.name, kind: reward.kind, units: parseDecimal(reward.units),
      unitCost: parseDecimal(reward.unitCost), retailPrice: parseDecimal(reward.retailPrice), opportunityCost: parseDecimal(reward.opportunityCost) })),
    redemptionPercent: value('redemptionPercent'),
    costs: Object.fromEntries(['subscription', 'setup', 'setupMonths', 'messaging', 'operations'].map(key => [key, value(key)])),
    purchase: { average: value('average'), mode: input('marginMode').value, marginPercent: value('marginPercent'), variableCost: value('variableCost'),
      additional: value('additional'), allowanceMode: input('allowanceMode').value, rewardAllowance: value('rewardAllowance') },
  };
}
function showStep(step, focus = true) {
  document.querySelectorAll('[data-panel]').forEach(panel => { /** @type {HTMLElement} */ (panel).hidden = Number(panel.getAttribute('data-panel')) !== step; });
  document.querySelectorAll('.calculator-steps [data-step]').forEach(button => {
    if (Number(button.getAttribute('data-step')) === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  if (focus) /** @type {HTMLElement} */ (document.querySelector(`[data-panel="${step}"] h2`)).focus();
}
function markChanged() {
  if (lastReport) { byId('changed-note').hidden = false; byId('results').hidden = true; lastReport = ''; }
}
function clearErrors() {
  byId('error-summary').hidden = true;
  document.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
  document.querySelectorAll('.field-error').forEach(element => { /** @type {HTMLElement} */ (element).hidden = true; });
}
function showErrors(errors) {
  clearErrors();
  const summary = byId('error-summary');
  const intro = document.createElement('p');
  intro.textContent = 'Revisa estos datos para continuar:';
  const list = document.createElement('ul');
  for (const error of errors) {
    const control = byId(error.field);
    const inline = byId(`${error.field}-error`);
    if (control) control.setAttribute('aria-invalid', 'true');
    if (inline) { inline.textContent = error.message; inline.hidden = false; }
    const item = document.createElement('li');
    const label = document.querySelector(`label[for="${error.field}"]`)?.textContent || 'Cálculo';
    const anchor = document.createElement(control ? 'a' : 'span');
    anchor.textContent = `${label}: ${error.message}`;
    if (control) {
      anchor.setAttribute('href', `#${error.field}`);
      anchor.addEventListener('click', event => {
        event.preventDefault();
        const panel = control.closest('[data-panel]');
        if (panel) showStep(Number(panel.getAttribute('data-panel')), false);
        const details = control.closest('details');
        if (details) details.open = true;
        control.focus();
      });
    }
    item.append(anchor); list.append(item);
  }
  summary.replaceChildren(intro, list); summary.hidden = false; summary.focus();
}
function lines(target, rows) {
  const list = byId(target); list.replaceChildren();
  rows.forEach(([label, text, total]) => {
    const row = document.createElement('div');
    if (total) row.className = 'total-line';
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = text;
    row.append(term, description); list.append(row);
  });
}
function warningsFor(result) {
  const warnings = [];
  if (result.unknownRewards.length) warnings.push(`Presupuesto incompleto: falta el costo de ${result.unknownRewards.map(reward => reward.name).join(', ')}. No se trata como cero. Los importes conocidos no son el total.`);
  if (result.omittedCosts.length) warnings.push(`Sin incluir por estar en blanco: ${result.omittedCosts.join(', ')}. Agrega esos importes para ampliar el presupuesto.`);
  if (result.omittedOpportunity.length) warnings.push(`Capacidad sin valorar: ${result.omittedOpportunity.join(', ')}. No se ha sumado contribución perdida por desplazar otras ventas.`);
  return warnings;
}
function showResult(scenario, result) {
  const money = amount => formatMoney(amount, scenario.currency);
  const warnings = warningsFor(result);
  byId('result-context').textContent = `${scenario.currency} · Canje supuesto: ${number(scenario.redemptionPercent)}%${exampleLabel ? ` · Ejemplo ficticio: ${exampleLabel}` : ' · Datos introducidos por ti'}`;
  const notices = byId('result-warnings'); notices.replaceChildren(); notices.hidden = !warnings.length;
  warnings.forEach(warning => { const p = document.createElement('p'); p.textContent = warning; notices.append(p); });
  lines('full-totals', [
    [result.unknownRewards.length ? 'Premios con costo conocido (subtotal)' : 'Entregar todos los premios', money(result.unknownRewards.length ? result.knownFullRewardCost : result.fullFulfillmentCost)],
    ...(!result.unknownRewards.length && result.fullOpportunityCost > 0 ? [['Contribución perdida por capacidad', money(result.fullOpportunityCost)]] : []),
    ['Gastos mensuales incluidos', money(result.monthlyCosts)], ['Presupuesto al 100%', money(result.fullBudget), true],
  ]);
  lines('scenario-totals', [[`Premios con canje del ${number(scenario.redemptionPercent)}%`, money(result.scenarioRewardCost)],
    ['Gastos mensuales incluidos', money(result.monthlyCosts)], ['Presupuesto del escenario', money(result.scenarioBudget), true]]);
  byId('scenario-note').textContent = `Se cuentan ${number(result.rewards.reduce((sum, reward) => sum + reward.scenarioUnits, 0))} canjes completos de ${number(result.rewards.reduce((sum, reward) => sum + reward.units, 0))} unidades base.${result.fullRewardCost !== null ? ` La diferencia pendiente de cumplir es ${money(result.fullRewardCost - result.scenarioRewardCost)}.` : ''}`;
  byId('break-even').textContent = result.breakEven === null ? 'Aún sin umbral calculable' : `${number(result.breakEven)} compras adicionales`;
  const reasons = {
    unknown_rewards: 'Completa el costo de todos los premios para obtener el umbral.',
    unknown_purchase: 'Agrega el importe medio y el margen o costo variable de una compra.',
    unknown_allowance: 'Falta la reserva por nuevos premios. Indícala o confirma que las compras adicionales no generan premios.',
    nonpositive_contribution: 'Cada compra deja una contribución de cero o negativa tras la reserva de premios. Aumentar las compras no cubre un presupuesto positivo con estos supuestos.',
    threshold_limit: 'El umbral excede el límite de cálculo de un billón de compras. Revisa el costo y la contribución por compra.',
  };
  byId('break-even-note').textContent = result.breakEven !== null
    ? `Cada compra dejaría ${money(result.contributionPerPurchase)} antes de nuevos premios; reservando ${money(result.allowance)} quedan ${money(result.availablePerPurchase)} para cubrir el escenario. ${result.breakEven === 0 ? 'El presupuesto incluido es cero.' : 'No es una predicción de ventas.'}`
    : reasons[result.thresholdReason] || 'Completa los datos de la compra y su reserva de premios.';
  byId('full-break-even').textContent = result.fullBreakEven !== null ? `Para cubrir el presupuesto al 100%: ${number(result.fullBreakEven)} compras adicionales.` : 'El umbral para cumplir el 100% también requiere datos completos y una contribución suficiente.';
  lines('contribution-totals', [
    ['Compras adicionales supuestas', scenario.purchase.additional === null ? 'Sin hipótesis' : number(scenario.purchase.additional)],
    ['Ventas adicionales supuestas', money(result.additionalRevenue)], ['Contribución antes del programa', money(result.grossContribution)],
    ['Reserva para nuevos premios', money(result.incrementalRewardCost)], ['Presupuesto del escenario', money(result.scenarioBudget)],
    ['Contribución después del programa', money(result.netContribution), true],
  ]);
  byId('net-note').textContent = result.netContribution === null ? 'No se supone crecimiento. Añade una hipótesis de compras y completa los costos para explorar este resultado.'
    : result.netContribution < 0 ? 'Con esta hipótesis queda un faltante por cubrir. La cifra solo contempla los costos incluidos; no es utilidad neta.'
      : 'La cifra solo contempla los costos incluidos. No es utilidad neta ni un retorno medido o garantizado.';
  const tbody = byId('reward-breakdown'); tbody.replaceChildren();
  result.rewards.forEach(reward => {
    const row = document.createElement('tr');
    [reward.name, number(reward.units), money(reward.fullCost), number(reward.scenarioUnits), money(reward.scenarioCost)].forEach((text, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = text;
      if (!index) cell.setAttribute('scope', 'row'); row.append(cell);
    }); tbody.append(row);
  });
  const assumptions = reportAssumptions(scenario);
  byId('print-assumptions').textContent = `Supuestos del cálculo\n\n${assumptions}`;
  lastReport = `PuntosFieles — Calculadora de recompensas\nhttps://puntosfieles.com/calculadora\n${new Date().toISOString().slice(0, 10)} · período de un mes\n${exampleLabel ? `Ejemplo ficticio: ${exampleLabel}` : 'Escenario con datos introducidos por la persona usuaria'}\n\n${assumptions}\n\nRESULTADOS\nPresupuesto al 100%: ${money(result.fullBudget)}\nPresupuesto del escenario: ${money(result.scenarioBudget)}\nContribución por compra tras reservar nuevos premios: ${money(result.availablePerPurchase)}\nCompras adicionales para cubrir el escenario: ${result.breakEven ?? 'Sin umbral calculable'}\nCompras adicionales para cubrir el 100%: ${result.fullBreakEven ?? 'Sin umbral calculable'}\nContribución después del programa: ${money(result.netContribution)}\n\n${warnings.join('\n')}\n\n${byId('break-even-note').textContent}\n\n${document.querySelector('.formula-copy').textContent}\nNo demuestra causalidad ni eficacia comercial de PF. No incluye importes que no se hayan anotado.`;
  byId('changed-note').hidden = true; byId('results').hidden = false; byId('results-heading').focus();
}
function reportAssumptions(scenario) {
  const amount = val => val === null ? 'sin dato / no incluido' : `${number(val)} ${scenario.currency}`;
  const kind = { product: 'producto', service: 'servicio', discount: 'descuento' };
  const rows = [`Moneda: ${scenario.currency}. Sin conversión de divisas. Canje base supuesto: ${number(scenario.redemptionPercent)}%.`, 'PREMIOS BASE (sin los generados por compras adicionales)'];
  scenario.rewards.forEach((reward, index) => {
    rows.push(`${reward.name || `Premio ${index + 1}`} (${kind[reward.kind]}): ${reward.units} unidades; costo unitario: ${amount(reward.unitCost)}${reward.kind === 'service' ? `; contribución perdida por capacidad: ${amount(reward.opportunityCost)}` : ''}${reward.kind !== 'discount' ? `; precio habitual, solo referencia: ${amount(reward.retailPrice)}` : ''}.`);
  });
  const c = scenario.costs, p = scenario.purchase;
  rows.push('GASTOS', `Suscripción mensual: ${amount(c.subscription)}. Mensajes: ${amount(c.messaging)}. Operación adicional: ${amount(c.operations)}.`,
    `Implementación única: ${amount(c.setup)}. Repartida en ${c.setupMonths ?? 'sin dato'} meses. Este reparto no representa el desembolso inicial.`,
    'COMPRAS ADICIONALES', `Importe medio antes del descuento del programa: ${amount(p.average)}.`,
    p.mode === 'margin' ? `Margen de contribución: ${p.marginPercent === null ? 'sin dato' : `${number(p.marginPercent)}%`}.` : `Costo variable por compra: ${amount(p.variableCost)}.`,
    `Hipótesis de compras adicionales del mes: ${p.additional === null ? 'sin hipótesis' : number(p.additional)}.`,
    `Reserva por compra adicional al 100%: ${p.allowanceMode === 'none' ? '0, se confirmó que no generan premios' : p.allowanceMode === 'amount' ? amount(p.rewardAllowance) : 'sin confirmar'}.`);
  return rows.join('\n');
}
function reset(exampleKey = 'own') {
  form.reset(); clearErrors(); lastReport = ''; exampleLabel = '';
  byId('results').hidden = true; byId('changed-note').hidden = true;
  input('currency').value = 'GTQ'; input('redemptionPercent').value = '100';
  const example = examples[exampleKey];
  if (example) {
    renderRewards(example.rewards); exampleLabel = example.name;
    for (const key of ['operations', 'average', 'marginPercent', 'additional', 'rewardAllowance']) input(key).value = String(example[key]);
    input('allowanceMode').value = 'amount';
    byId('example-note').textContent = `Ejemplo ficticio: ${example.name}. Todas las cifras son editables. ${example.note} Suscripción, implementación y mensajes quedan fuera hasta que los agregues.`;
    byId('example-note').hidden = false;
  } else { renderRewards([blankReward()]); byId('example-note').hidden = true; }
  input('example').value = exampleKey; syncPurchase(); syncCurrency(); showStep(0, false);
}

for (const [code, name] of Object.entries(REGIONAL_CURRENCIES)) {
  const option = document.createElement('option'); option.value = code; option.textContent = `${code} · ${name}`; byId('currency').append(option);
}
byId('currency').addEventListener('change', syncCurrency);
byId('marginMode').addEventListener('change', syncPurchase);
byId('allowanceMode').addEventListener('change', syncPurchase);
form.addEventListener('input', markChanged); form.addEventListener('change', markChanged);
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => showStep(Number(button.getAttribute('data-step')))));
document.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => {
  const next = Number(button.getAttribute('data-next'));
  const errors = calculateLoyalty(readScenario()).errors.filter(error => next === 1 ? error.field.startsWith('reward-') || error.field === 'currency' : !['average', 'marginPercent', 'variableCost', 'additional', 'rewardAllowance'].includes(error.field));
  if (errors.length) return showErrors(errors);
  clearErrors(); showStep(next);
}));
byId('add-reward').addEventListener('click', () => {
  if (rewardCount >= LIMITS.rewards) return;
  renderRewards([...rawRewards(), blankReward()]); markChanged(); input(`reward-${rewardCount - 1}-name`).focus();
});
byId('load-example').addEventListener('click', () => { reset(input('example').value); byId('rewards-heading').focus(); });
byId('reset-calculator').addEventListener('click', () => { reset(); byId('rewards-heading').focus(); });
form.addEventListener('submit', event => {
  event.preventDefault(); clearErrors(); const scenario = readScenario(); const result = calculateLoyalty(scenario);
  if (result.errors.length) return showErrors(result.errors);
  showStep(2, false); showResult(scenario, result);
});
byId('print-summary').addEventListener('click', () => window.print());
byId('download-summary').addEventListener('click', () => {
  if (!lastReport) return;
  const url = URL.createObjectURL(new Blob([lastReport], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'escenario-recompensas-pf.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
reset(); byId('calculator-app').hidden = false;
