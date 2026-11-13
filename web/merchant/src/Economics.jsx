import IssuedCommitments from './IssuedCommitments.jsx';
import { useState } from 'react';
import { Accordion, Alert, Badge, Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { api, isDemo, useResource } from './api.js';
import { BusinessLink, Failure, Loading, Locked, money, number, periodDate } from './ui.jsx';
import { merchantRegion } from './region.js';
import CommitmentScenarios from './CommitmentScenarios.jsx';

const nullable = value => value === '' ? null : Number(value);

export default function Economics({ features }) {
  const [days, setDays] = useState('30');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const resource = useResource(features.analytics ? `/api/admin/reward-economics?days=${days}&offset=${offset}` : null, refresh);
  if (!features.analytics) return <Locked feature="Costos de recompensas" />;
  const data = resource.data;
  const region = data?.region || merchantRegion();
  function saved(message) {
    setEditing(null);
    setNotice(message);
    setRefresh(value => value + 1);
  }
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>El costo de tus recompensas</Title>
        <Text className="intro">Registra cuánto te cuesta entregar cada premio y consulta lo que ya conoces de tus canjes.</Text>
      </div>
      <Group justify="space-between" align="end" className="filters">
        <Select label="Período de ventas y canjes" value={days} onChange={value => setDays(value || '30')} allowDeselect={false} data={[{ value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]} w={230} />
        <Button variant="default" disabled={resource.loading} onClick={() => setRefresh(value => value + 1)}>Actualizar</Button>
      </Group>
      {notice && <Alert color="green" role="status">{notice}</Alert>}
      {resource.loading ? <Loading label="Consultando costos y saldos…" /> : resource.error ? <Failure error={resource.error} retry={() => setRefresh(value => value + 1)} /> : data && <>
        <div className="scope-line">
          <Text size="sm" fw={500}>Todo el negocio · {periodDate(data.period.start, data.timezone)}–{periodDate(data.period.end, data.timezone)}</Text>
          <Text size="xs" c="dimmed">Moneda: {data.currency || region.currency} · hoy es parcial{isDemo ? ' · datos ficticios' : ''}</Text>
        </div>
        <section aria-labelledby="economics-observed">
          <Title order={2} id="economics-observed" mb="md">Datos registrados</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={0} className="metric-strip">
            <Metric label="Costo conocido de premios" value={money(data.observed.known_reward_cost_q)} detail={`${number(data.observed.costed_redemptions)} canjes con costo registrado al completarse.`} />
            <Metric label="Cobertura de costos" value={data.observed.cost_coverage_pct === null ? '—' : `${number(data.observed.cost_coverage_pct)}%`} detail={`${number(data.observed.costed_redemptions)} de ${number(data.observed.completed_redemptions)} canjes completados.`} />
            <Metric label="Ventas registradas" value={money(data.observed.recorded_sales_q)} detail={`${number(data.observed.recorded_purchases)} compras registradas en el programa.`} />
          </SimpleGrid>
          {data.observed.unknown_cost_redemptions > 0 ? <Alert color="yellow" mt="md" title="El costo total todavía es desconocido">
            {number(data.observed.unknown_cost_redemptions)} canjes no tienen costo registrado. El importe conocido es una parte del costo; guardar costos hoy no completa el historial.
          </Alert> : data.observed.completed_redemptions === 0 && <Alert color="gray" mt="md">No hay canjes completados en este período. Puedes preparar los costos de tus próximos premios abajo.</Alert>}
          <Text size="sm" c="dimmed" mt="md">Las ventas del programa no equivalen a todas las ventas de tu negocio ni a ventas causadas por tus recompensas. Se excluyen compras completamente revertidas; devoluciones parciales o pendientes del POS aún pueden estar incluidas.</Text>
        </section>
        <section className="operation-section" aria-labelledby="economics-rewards">
          <Title order={2} id="economics-rewards">Costos para futuros canjes</Title>
          <Text size="sm" c="dimmed" mt="sm" mb="md">Ingresa tu costo por unidad entregada, no su precio de venta. Deja vacío lo que desconoces; cero significa que confirmaste un costo cero. Los puntos de cada premio se administran por separado.</Text>
          {data.rewards.length ? <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Caption>Los cambios aplican a los próximos canjes completados y no modifican los costos históricos.</Table.Caption>
              <Table.Thead><Table.Tr><Table.Th>Recompensa</Table.Th><Table.Th ta="right">Puntos</Table.Th><Table.Th ta="right">Costo unitario</Table.Th><Table.Th ta="right">Valor de venta</Table.Th><Table.Th>Acción</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{data.rewards.map(reward => <Table.Tr key={reward.id}>
                <Table.Td><Text fw={500}>{reward.name}</Text>{(!reward.active || (reward.valid_until && new Date(reward.valid_until) < new Date(data.generated_at))) && <Text size="xs" c="dimmed">{!reward.active ? 'Inactiva' : 'Vencida'}</Text>}</Table.Td>
                <Table.Td ta="right">{number(reward.points_cost)}</Table.Td>
                <Table.Td ta="right">{reward.unit_cost_q === null ? 'Sin registrar' : money(reward.unit_cost_q)}</Table.Td>
                <Table.Td ta="right">{reward.retail_value_q==null?'Sin registrar':money(reward.retail_value_q)}</Table.Td><Table.Td><Button variant="subtle" size="compact-sm" mih={44} aria-label={`Editar costo de ${reward.name}`} onClick={() => setEditing({ kind: 'reward', reward })}>Editar costo</Button></Table.Td>
              </Table.Tr>)}</Table.Tbody>
            </Table>
          </Table.ScrollContainer> : <Text>No hay recompensas en esta página. <BusinessLink href="/administracion/?seccion=recompensas">Administrar recompensas</BusinessLink></Text>}
          {data.rewards_pagination.total > 50 && <Group mt="md" justify="space-between"><Button variant="default" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Anterior</Button><Text size="sm">{number(offset + 1)}–{number(Math.min(offset + 50, data.rewards_pagination.total))} de {number(data.rewards_pagination.total)}</Text><Button variant="default" disabled={!data.rewards_pagination.has_more} onClick={() => setOffset(value => value + 50)}>Siguiente</Button></Group>}
        </section>
        <section className="operation-section" aria-labelledby="economics-balances">
          <Title order={2} id="economics-balances">Puntos vigentes hoy</Title>
          <Text size="sm" c="dimmed" mt="sm">Saldos actuales de clientes activos. No se limitan al período seleccionado y pueden cambiar por canjes, vencimientos o ajustes.</Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={0} className="metric-strip" mt="md">
            <Metric label="Disponibles para canjear" value={number(data.observed.outstanding_points)} detail="Suma de saldos positivos actuales." />
            <Metric label="Pendientes de liberación" value={number(data.observed.pending_points)} detail="Todavía no están disponibles para canjear." />
            <Metric label="Canjeados en el período" value={number(data.observed.points_redeemed)} detail="Puntos de canjes completados, guardados en cada canje." />
          </SimpleGrid>
          {data.observed.negative_balance_points < 0 && <Text size="sm" mt="sm">Saldos negativos registrados por separado: {number(data.observed.negative_balance_points)} puntos.</Text>}
        </section>
        <section className="operation-section" aria-labelledby="economics-estimates">
          <Group justify="space-between" align="start"><div><Group gap="sm"><Title order={2} id="economics-estimates">Estimaciones con tus supuestos</Title><Badge color="gray" variant="light">Estimación</Badge></Group><Text size="sm" c="dimmed" mt="sm" maw={720}>Usa estas cifras para explorar escenarios. No son utilidad neta, obligaciones contables ni una medición del retorno causado por el programa.</Text></div><Button variant="outline" onClick={() => setEditing({ kind: 'settings' })}>Editar supuestos</Button></Group>
          <Text size="sm" mt="md">Margen bruto supuesto: {data.settings.gross_margin_pct === null ? 'sin registrar' : `${number(data.settings.gross_margin_pct)}%`}. Costo supuesto por punto: {data.settings.cost_per_point_q === null ? 'sin registrar' : `${new Intl.NumberFormat(region.locale, { maximumFractionDigits: 6 }).format(data.settings.cost_per_point_q)} ${region.currency}`}.</Text>
          <Table mt="md"><Table.Caption>Cálculos con los supuestos actuales del negocio. No cambian los costos observados de premios.</Table.Caption><Table.Tbody>
            <Estimate label="Margen bruto estimado antes de premios" value={data.estimates.gross_margin_before_rewards_q} detail="Ventas registradas × margen bruto supuesto." />
            <Estimate label="Margen estimado después de premios" value={data.estimates.margin_after_rewards_q} detail={data.estimates.margin_unavailable_reason === 'incomplete_reward_costs' ? 'No disponible: faltan costos de canjes. Requiere cobertura completa.' : data.estimates.margin_unavailable_reason === 'missing_gross_margin' ? 'Ingresa un margen bruto para estimar. También requiere todos los costos de canjes.' : 'Margen bruto estimado menos costos de todos los canjes completados del período.'} />
            <Estimate label="Costo potencial de puntos disponibles" value={data.estimates.outstanding_points_cost_q} detail="Puntos disponibles × costo supuesto por punto. No se descuenta del margen del período." />
            <Estimate label="Costo potencial de puntos pendientes" value={data.estimates.pending_points_cost_q} detail="Puntos pendientes × costo supuesto por punto. Escenario separado; aún no se pueden canjear." />
          </Table.Tbody></Table>
        </section>
        <IssuedCommitments key={`issued-${refresh}`}/>
        <CommitmentScenarios key={`${days}-${refresh}`} data={data} days={days}/>
        <Accordion><Accordion.Item value="definitions"><Accordion.Control>Cómo leer estas cifras</Accordion.Control><Accordion.Panel><Stack gap="sm">{data.notes.map(note => <Text size="sm" key={note}>{note}</Text>)}</Stack></Accordion.Panel></Accordion.Item></Accordion>
      </>}
      <Modal opened={!!editing} onClose={() => { if (!saving) setEditing(null); }} title={editing?.kind === 'reward' ? 'Costo unitario de la recompensa' : 'Tus supuestos para estimar'} centered closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
        {editing?.kind === 'reward' ? <CostForm key={editing.reward.id} reward={editing.reward} region={region} saved={saved} saving={saving} setSaving={setSaving} /> : editing?.kind === 'settings' && data ? <AssumptionsForm settings={data.settings} region={region} saved={saved} saving={saving} setSaving={setSaving} /> : null}
      </Modal>
    </Stack>
  );
}

function Metric({ label, value, detail }) {
  return <div className="metric"><Text size="sm" fw={500}>{label}</Text><Text className="metric-value">{value}</Text><Text size="xs" c="dimmed">{detail}</Text></div>;
}
function Estimate({ label, value, detail }) {
  return <Table.Tr><Table.Th fw={500}><Text size="sm" fw={500}>{label}</Text><Text size="xs" c="dimmed" fw={400} mt={4}>{detail}</Text></Table.Th><Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{value === null ? 'Sin estimar' : money(value)}</Table.Td></Table.Tr>;
}
function CostForm({ reward, region, saved, saving, setSaving }) {
  const [value, setValue] = useState(reward.unit_cost_q ?? '');
  const [retail,setRetail]=useState(reward.retail_value_q??'');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    try {
      await api(`/api/admin/reward-economics/rewards/${encodeURIComponent(reward.id)}`, { method: 'PUT', body: JSON.stringify({ unit_cost_q: nullable(value),retail_value_q:nullable(retail) }) });
      saved(`Costo de ${reward.name} guardado para futuros canjes.`);
    } catch (failure) { setError(failure.message || 'No se pudo guardar el costo.'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit}><Stack gap="md"><Text fw={600}>{reward.name}</Text><NumberInput label={`Tu costo por unidad (${region.currency})`} description="Vacío significa desconocido. Escribe 0 solo si confirmaste un costo cero." value={value} onChange={setValue} min={0} max={1000000} decimalScale={region.minorUnits} allowNegative={false} disabled={saving} /><NumberInput label={`Valor de venta al cliente (${region.currency})`} description="Precio de una unidad. Vacío significa desconocido; se conserva al emitir nuevos beneficios." value={retail} onChange={setRetail} min={0} max={1000000} decimalScale={region.minorUnits} allowNegative={false} disabled={saving}/><Text size="sm" c="dimmed">Se guardará junto a cada nuevo canje completado. No se aplicará a canjes anteriores ni cambiará sus puntos.</Text>{error && <Alert color="red" role="alert">{error}</Alert>}<Button type="submit" mih={44} loading={saving}>Guardar costo</Button></Stack></form>;
}
function AssumptionsForm({ settings, region, saved, saving, setSaving }) {
  const [margin, setMargin] = useState(settings.gross_margin_pct ?? '');
  const [point, setPoint] = useState(settings.cost_per_point_q ?? '');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    try {
      await api('/api/admin/reward-economics/settings', { method: 'PUT', body: JSON.stringify({ gross_margin_pct: nullable(margin), cost_per_point_q: nullable(point) }) });
      saved('Supuestos guardados. Las estimaciones usan estos valores; los costos históricos no cambian.');
    } catch (failure) { setError(failure.message || 'No se pudieron guardar los supuestos.'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit}><Stack gap="md"><Text size="sm">Ambos campos son opcionales. Déjalos vacíos si todavía no tienes un supuesto propio.</Text><NumberInput label="Margen bruto supuesto (%)" description="Se aplica a las ventas registradas para estimar el margen antes de premios." value={margin} onChange={setMargin} min={0} max={100} decimalScale={2} allowNegative={false} disabled={saving} /><NumberInput label={`Costo supuesto por punto (${region.currency})`} description="Solo estima el costo potencial de los puntos vigentes; no modifica los costos de canjes." value={point} onChange={setPoint} min={0} max={1000} decimalScale={6} allowNegative={false} disabled={saving} />{error && <Alert color="red" role="alert">{error}</Alert>}<Button type="submit" mih={44} loading={saving}>Guardar supuestos</Button></Stack></form>;
}
