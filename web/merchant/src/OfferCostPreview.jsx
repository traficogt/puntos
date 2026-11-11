import { useState } from 'react';
import { Accordion, Alert, Anchor, Button, NumberInput, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useResource } from './api.js';
import { merchantRegion } from './region.js';
import { Failure, Loading, number } from './ui.jsx';
import { budgetFromAllowance, marginIllustration, offerCostPreview } from './offer-cost-model.js';

const emptyAsNull = value => value === '' ? null : value;
export default function OfferCostPreview({ values, audienceCount, busy, onCostChange, onBudgetChange }) {
  const region = merchantRegion();
  const [allowance, setAllowance] = useState(''), [percent, setPercent] = useState(100);
  const [sale, setSale] = useState(''), [margin, setMargin] = useState('');
  const [lookup, setLookup] = useState(false), [revision, setRevision] = useState(0), [applied, setApplied] = useState(null);
  const saved = useResource(lookup ? '/api/admin/reward-economics' : null, revision);
  const pointCost = emptyAsNull(values.estimated_cost_per_point_q);
  const args = { bonusPoints: values.bonus_points, pointsBudget: emptyAsNull(values.points_budget), audienceCount,
    holdoutPercent: Number(values.holdout_percent), quiet: values.offer_kind === 'quiet', costPerPoint: pointCost, minorUnits: region.minorUnits };
  const preview = offerCostPreview(args);
  const scenario = typeof percent === 'number' ? offerCostPreview({ ...args, redemptionPercent: percent }) : null;
  const conversion = budgetFromAllowance({ allowance, costPerPoint: pointCost, bonusPoints: values.bonus_points, minorUnits: region.minorUnits });
  const illustration = marginIllustration({ saleAmount: sale, grossMarginPct: margin, bonusPoints: values.bonus_points, costPerPoint: pointCost, minorUnits: region.minorUnits });
  const money = value => new Intl.NumberFormat(region.locale, { style: 'currency', currency: region.currency, minimumFractionDigits: region.minorUnits, maximumFractionDigits: region.minorUnits }).format(value);
  const costText = value => value === null ? 'Desconocido' : money(value);
  const savedCost = saved.data?.settings?.cost_per_point_q, savedMargin = saved.data?.settings?.gross_margin_pct;
  const sameCurrency = saved.data?.currency === region.currency;
  const reusableCost = sameCurrency && typeof savedCost === 'number' && savedCost >= 0 && savedCost <= 100;
  const staleConversion = applied && (applied.cost !== pointCost || applied.bonus !== values.bonus_points);
  const allowanceMessages = {
    unknown_cost: 'Ingresa un costo por punto conocido para calcular el límite.',
    zero_cost: 'Con costo cero, el importe no define un límite. Elige el límite de puntos directamente.',
    below_one_bonus: 'El importe no alcanza para un bono completo. Aumenta el importe o revisa el bono y su costo.',
    invalid: 'Revisa el importe, los puntos del bono y el costo antes de calcular.',
  };
  return <section className="operation-section" aria-labelledby="offer-cost-heading">
    <Stack gap="md">
      <Title order={3} id="offer-cost-heading">Costo y límite de esta oferta</Title>
      <Text size="sm" maw="72ch">El límite se aplica a los puntos extra otorgados. Su costo en dinero depende de tu supuesto por punto y de los canjes; no es un gasto confirmado.</Text>
      {!preview ? <Text role="status">Revisa los puntos, el límite y el costo para calcular la vista previa.</Text> : <>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <div><Text fw={600}>Compromiso de puntos extra</Text><Text>{values.points_budget === '' ? 'Sin límite adicional de puntos.' : `Límite elegido: ${number(values.points_budget)} puntos.`}</Text>
            {preview.maximumPoints === null ? <Text size="sm">Falta una audiencia vigente o un límite de puntos para calcular el compromiso.</Text> : <Text size="sm">Hasta {number(preview.maximumBonuses)} bonos completos · {number(preview.maximumPoints)} puntos extra.</Text>}
            {audienceCount !== null && <Text size="sm" c="dimmed">{number(audienceCount)} clientes en la consulta · {number(preview.treatmentCount)} con oferta{!args.quiet && ` · ${number(preview.controlCount)} para comparación`}.</Text>}
          </div>
          <div><Text fw={600}>Si se canjean todos esos puntos</Text><Text>{costText(preview.maximumCost)}</Text><Text size="sm" c="dimmed">{pointCost === null ? 'Falta tu costo por punto; desconocido no significa cero.' : `Usa ${new Intl.NumberFormat(region.locale, { maximumFractionDigits: 6 }).format(pointCost)} ${region.currency} por punto.`}</Text></div>
        </SimpleGrid>
        <Text size="sm" c="dimmed">La audiencia se calcula de nuevo al guardar. La comprobación previa confirma el máximo antes de activar. Se excluyen puntos normales, descuentos externos, mensajes y operación. Los importes de costo se redondean hacia arriba a la unidad mínima de {region.currency}.</Text>
      </>}
      {!lookup ? <Button type="button" variant="subtle" w="fit-content" mih={44} disabled={busy} onClick={() => setLookup(true)}>Consultar mis supuestos guardados</Button>
        : saved.loading ? <Loading label="Consultando tus supuestos…" /> : saved.error ? <Failure error={saved.error} retry={() => setRevision(value => value + 1)} /> : saved.data && <Stack gap="xs">
          <Text size="sm">Costo guardado por punto: {savedCost == null ? 'sin registrar' : `${new Intl.NumberFormat(region.locale, { maximumFractionDigits: 6 }).format(savedCost)} ${saved.data.currency}`}. <Anchor href="#costos">Revisar costos y margen</Anchor></Text>
          {!sameCurrency ? <Alert color="yellow">La moneda del supuesto no coincide con esta oferta. Actualiza la página y revisa la región del negocio.</Alert> : savedCost != null && !reusableCost ? <Text size="sm">El costo guardado supera el máximo de 100 por punto permitido para campañas. Ingresa un supuesto válido en esta oferta.</Text> : null}
          <Button type="button" variant="default" w="fit-content" mih={44} disabled={busy || !reusableCost} onClick={() => onCostChange(savedCost)}>Usar costo guardado en esta oferta</Button>
          <Text size="xs" c="dimmed">Se copia al borrador. Las ediciones posteriores de tus supuestos no cambian una oferta guardada.</Text>
        </Stack>}
      <Accordion multiple variant="default">
        <Accordion.Item value="allowance"><Accordion.Control>Calcular un límite desde un importe</Accordion.Control><Accordion.Panel><Stack gap="md">
          <Text size="sm">Convierte tu importe en bonos completos usando el costo actual. El límite que se guarda y se controla está expresado en puntos.</Text>
          <NumberInput label={`Importe disponible para el bono (${region.currency})`} value={allowance} onChange={setAllowance} min={0} max={1000000000} decimalScale={region.minorUnits} allowNegative={false} disabled={busy} maw={360} />
          {allowance !== '' && (conversion.reason ? <Text size="sm" role="status">{allowanceMessages[conversion.reason]}</Text> : <><Text size="sm">Hasta {number(conversion.bonuses)} bonos · {number(conversion.pointsBudget)} puntos · costo supuesto de {money(conversion.estimatedCost)}.</Text><Button type="button" variant="default" w="fit-content" mih={44} disabled={busy} onClick={() => { onBudgetChange(conversion.pointsBudget);setApplied({ cost: pointCost, bonus: values.bonus_points, points: conversion.pointsBudget }); }}>Aplicar límite de {number(conversion.pointsBudget)} puntos</Button></>)}
          {applied && <Text size="sm" role="status">{staleConversion ? 'Cambiaste el costo o el bono después de calcular el límite. Recalcula y aplica si quieres mantener el importe previsto.' : values.points_budget !== applied.points ? 'El límite de puntos se editó después del cálculo. El borrador usará el valor actual del formulario.' : `Límite aplicado: ${number(applied.points)} puntos. Se guardará con el borrador.`}</Text>}
          <Text size="xs" c="dimmed">Un escenario de canje menor no permite aumentar este límite. El costo real puede cambiar; las devoluciones no reponen puntos comprometidos.</Text>
        </Stack></Accordion.Panel></Accordion.Item>
        <Accordion.Item value="scenario"><Accordion.Control>Explorar un escenario de canje</Accordion.Control><Accordion.Panel><Stack gap="md">
          <Text size="sm">Elige una proporción de los puntos máximos que se canjearían. Es una hipótesis tuya, no un pronóstico. No reduce el compromiso máximo ni modifica el límite.</Text>
          <NumberInput label="Puntos extra que se canjearían (%)" value={percent} onChange={setPercent} min={0} max={100} allowDecimal={false} disabled={busy} maw={360} />
          {scenario?.scenarioPoints != null && <Text>{number(scenario.scenarioPoints)} puntos · costo supuesto: {costText(scenario.scenarioCost)}.</Text>}
        </Stack></Accordion.Panel></Accordion.Item>
        <Accordion.Item value="margin"><Accordion.Control>Ilustrar margen de una compra</Accordion.Control><Accordion.Panel><Stack gap="md">
          <Text size="sm">Introduce una compra de ejemplo y tu margen bruto supuesto. Se resta el costo de canjear todos los puntos de un solo bono.</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}><NumberInput label={`Importe de la compra del ejemplo (${region.currency})`} value={sale} onChange={setSale} min={0} max={1000000000} decimalScale={region.minorUnits} allowNegative={false} disabled={busy} /><NumberInput label="Margen bruto supuesto para el ejemplo (%)" value={margin} onChange={setMargin} min={0} max={100} decimalScale={2} allowNegative={false} disabled={busy} /></SimpleGrid>
          {sameCurrency && typeof savedMargin === 'number' && <Button type="button" variant="subtle" w="fit-content" mih={44} disabled={busy} onClick={() => setMargin(savedMargin)}>Usar margen guardado de {number(savedMargin)}%</Button>}
          {illustration && <Stack gap="xs"><Text size="sm">Margen bruto del ejemplo: {money(illustration.grossMargin)} · costo supuesto de un bono: {costText(illustration.bonusCost)}.</Text><Text fw={600}>Margen ilustrativo después del bono: {costText(illustration.afterBonus)}.</Text></Stack>}
          {typeof sale === 'number' && sale < values.minimum_purchase_q && <Text size="sm">Esta compra de ejemplo no alcanza el mínimo de la oferta.</Text>}
          <Text size="sm" c="dimmed">No es utilidad neta ni retorno de la campaña. Excluye los puntos normales, descuentos externos, mensajes y operación. Estos ejemplos no se guardan como términos ni cambian tus supuestos del negocio.</Text>
        </Stack></Accordion.Panel></Accordion.Item>
      </Accordion>
    </Stack>
  </section>;
}
