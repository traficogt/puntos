import { useState } from 'react';
import { Accordion, Anchor, Button, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { isDemo, useResource } from './api.js';
import { Failure, Loading, money, number, periodDate } from './ui.jsx';
import { activityHistoryHref, activitySourceLabels } from './activity-drilldown.js';
import { demoActivationInsights } from './demo-activation-insights.js';

function useInsight(kind, branchId, refresh) {
  const [retry, setRetry] = useState(0);
  const result = useResource(isDemo ? null : `/api/admin/activation-insights/${kind}${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''}`, `${refresh}:${retry}`);
  return { ...result, data: isDemo ? demoActivationInsights(kind, branchId) : result.data, retry: () => setRetry(value => value + 1) };
}
function Missing({ count }) {
  return <Text size="sm" c={count ? undefined : 'dimmed'}>{count ? `${number(count)} sin costo actual registrado` : 'Todos tienen costo actual registrado.'}</Text>;
}
function Amount({ value }) { return <Text fw={600}>{value === null ? 'Costo desconocido' : money(value)}</Text>; }
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
export function RewardExposurePanel({ branchId = null, refresh = 0 }) {
  const result = useInsight('reward-exposure', branchId, refresh), data = result.data;
  const complete = data?.issued && data?.points && data?.protected_choices && data?.completed?.period;
  return <section className="operation-section" aria-labelledby="reward-exposure-heading"><Stack gap="lg">
    <Group justify="space-between" align="start"><div><Title order={2} id="reward-exposure-heading">Beneficios por entregar</Title><Text size="sm" mt="xs" c="dimmed">Cortesías vigentes, opciones protegidas y puntos: cada uno con su alcance.</Text></div><Button component="a" href="#costos" variant="subtle" mih={44}>Ver costos y supuestos</Button></Group>
    {isDemo && <Text size="sm" c="dimmed">Ejemplo ficticio para explorar. No representa beneficios ni costos de un negocio real.</Text>}
    {result.loading ? <Loading label="Consultando beneficios pendientes…" /> : result.error || !complete ? <Failure error={result.error} retry={result.retry} /> : <>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <div><Text fw={600}>Cortesías emitidas</Text><Text mt="xs">{data.issued.outstanding ? `${number(data.issued.outstanding)} vigentes por entregar` : 'No hay cortesías vigentes por entregar.'}</Text><Text size="sm" c="dimmed" mt={4}>{branchId ? 'Sucursal seleccionada' : 'Todo el negocio'} · a la fecha de consulta</Text></div>
        <div><Text size="sm" mb={4}>Costo actual estimado conocido</Text><Amount value={data.issued.known_estimated_cost_q}/><Missing count={data.issued.missing_cost}/><Text size="xs" c="dimmed" mt={4}>{number(data.issued.costed)} de {number(data.issued.outstanding)} cortesías con costo. {data.issued.missing_cost > 0 ? 'El importe mostrado es parcial.' : 'Un costo registrado de cero sí cuenta.'}</Text></div>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <div><Text fw={600}>Opciones protegidas por puntos</Text><Text size="sm" mt="xs">{number(data.protected_choices.open_cycles)} ciclos abiertos · {number(data.protected_choices.alternatives)} opciones vigentes en todo el negocio.</Text><Text size="sm" c="dimmed" mt={4}>Son alternativas: el cliente elige una para cerrar su ciclo. No son premios adicionales ya emitidos.</Text>{data.protected_choices.cycles_missing_cost > 0 && <Text size="sm" mt={4}>{number(data.protected_choices.cycles_missing_cost)} ciclos incluyen opciones sin costo registrado.</Text>}</div>
        <div><Text fw={600}>Escenario de puntos disponibles</Text><Text size="sm" mt="xs">{number(data.points.outstanding)} puntos en todo el negocio.</Text>{data.points.scenario_cost_q === null ? <Text size="sm" mt={4}>Falta tu supuesto de costo por punto. Puedes configurarlo en Costos y margen.</Text> : <><Text fw={600} mt={4}>{money(data.points.scenario_cost_q)} estimados</Text><Text size="sm" c="dimmed">Usa tu supuesto actual de {new Intl.NumberFormat(data.region.locale, { maximumFractionDigits: 6 }).format(data.points.cost_per_point_q)} {data.currency} por punto.</Text></>}<Text size="xs" c="dimmed" mt={4}>{number(data.points.pending)} puntos pendientes y {number(data.points.negative)} de saldos negativos, separados del escenario.</Text></div>
      </SimpleGrid>
      <Accordion variant="default"><Accordion.Item value="assumptions"><Accordion.Control mih={44}>Cómo se estiman estos importes</Accordion.Control><Accordion.Panel><Stack gap="sm" maw="72ch">
        <Text size="sm">El costo de las cortesías usa tus costos unitarios actuales. Al emitirlas se registraron {money(data.issued.approved_at_issue_cost_q)} en costos aprobados; esos términos originales no se reescriben. Los importes no confirman disponibilidad ni entrega.</Text>
        <Text size="sm">No sumes las cortesías, las opciones protegidas y el escenario de puntos. Los puntos pueden financiar esas mismas opciones. Son estimaciones para planificar, no obligaciones contables.</Text>
        <Text size="sm">Canjes completados en los últimos 30 días ({periodDate(data.completed.period.start, data.timezone)}–{periodDate(data.completed.period.end, data.timezone)}): {number(data.completed.count)}. Costo conocido guardado al completar: {data.completed.known_snapshot_cost_q === null ? 'desconocido' : money(data.completed.known_snapshot_cost_q)}. {number(data.completed.missing_cost)} sin costo histórico registrado.</Text>
        <Text size="sm" c="dimmed">Los costos históricos se mantienen aunque después cambies los costos o restaures puntos. Los saldos y ciclos son de todo el negocio; no se reparten entre sucursales. El historial usa la sucursal seleccionada.</Text>
      </Stack></Accordion.Panel></Accordion.Item></Accordion>
    </>}
  </Stack></section>;
}
function ActivityCells({ row }) {
  return <><Table.Td ta="right">{number(row.purchases)}</Table.Td><Table.Td ta="right">{number(row.awards)}<Text size="xs" c="dimmed">{signed(row.points_awarded)} puntos</Text></Table.Td><Table.Td ta="right">{number(row.adjustments)}<Text size="xs" c="dimmed">{signed(row.adjustment_points)} disponibles</Text>{row.adjustment_pending_points !== 0 && <Text size="xs" c="dimmed">{signed(row.adjustment_pending_points)} pendientes</Text>}</Table.Td><Table.Td ta="right">{number(row.reversals)}<Text size="xs" c="dimmed">{signed(row.reversal_points)} puntos</Text></Table.Td></>;
}
function ActivityRows({ data, rows, source = false }) {
  const label = row => source ? activitySourceLabels[row.group] : row.name;
  const href = row => activityHistoryHref(data, source ? { source_group: row.group } : { staff_id: row.staff_id, source_group: 'staff' });
  return <>
    <Stack hiddenFrom="sm" gap="lg">{rows.map(row => <div key={row.staff_id || row.group}>
      <Anchor href={href(row)} aria-label={`Ver movimientos de ${label(row)}`} fw={600} display="inline-block" py="xs" mih={44}>{label(row)}</Anchor>{row.active === false && <Text size="xs" c="dimmed">Cuenta actualmente inactiva</Text>}
      <SimpleGrid cols={2} mt="xs" spacing="md"><div><Text size="sm">Compras</Text><Text fw={500}>{number(row.purchases)}</Text></div><div><Text size="sm">Abonos de puntos</Text><Text fw={500}>{number(row.awards)} · {signed(row.points_awarded)} puntos</Text></div><div><Text size="sm">Ajustes manuales</Text><Text fw={500}>{number(row.adjustments)} · {signed(row.adjustment_points)} puntos</Text>{row.adjustment_pending_points !== 0 && <Text size="xs" c="dimmed">{signed(row.adjustment_pending_points)} pendientes</Text>}</div><div><Text size="sm">Reversiones</Text><Text fw={500}>{number(row.reversals)} · {signed(row.reversal_points)} puntos</Text></div></SimpleGrid>
    </div>)}</Stack>
    <Table.ScrollContainer visibleFrom="sm" minWidth={650} type="native" tabIndex={0} role="region" aria-label={source ? 'Actividad por origen' : 'Actividad por persona'}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">{source ? 'Origen registrado' : 'Persona registrada'}</Table.Th><Table.Th scope="col" ta="right">Compras</Table.Th><Table.Th scope="col" ta="right">Abonos</Table.Th><Table.Th scope="col" ta="right">Ajustes manuales</Table.Th><Table.Th scope="col" ta="right">Reversiones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={row.staff_id || row.group}><Table.Th scope="row"><Anchor href={href(row)} aria-label={`Ver movimientos de ${label(row)}`} fw={500} display="inline-block" py="xs" mih={44}>{label(row)}</Anchor>{row.active === false && <Text size="xs" c="dimmed">Cuenta actualmente inactiva</Text>}</Table.Th><ActivityCells row={row}/></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
  </>;
}
export function StaffActivityPanel({ branchId = null, refresh = 0 }) {
  const result = useInsight('staff-activity', branchId, refresh), data = result.data;
  const complete = data?.totals && data?.period && Array.isArray(data.staff) && Array.isArray(data.sources);
  return <section className="operation-section" aria-labelledby="staff-activity-heading"><Stack gap="lg">
    <div><Title order={2} id="staff-activity-heading">Actividad del equipo esta semana</Title><Text size="sm" mt="xs" c="dimmed">Revisa lo registrado y abre los movimientos para entender su contexto.</Text></div>
    {isDemo && <Text size="sm" c="dimmed">Personas y movimientos ficticios para explorar el resumen.</Text>}
    {result.loading ? <Loading label="Consultando la actividad del equipo…"/> : result.error || !complete ? <Failure error={result.error} retry={result.retry}/> : <>
      <Text size="sm">Desde el lunes {periodDate(data.period.start, data.timezone)} hasta {periodDate(data.period.end, data.timezone)} · {data.timezone} · semana en curso. {branchId ? 'Sucursal seleccionada.' : 'Todo el negocio.'}</Text>
      {data.totals.movements === 0 ? <Text>Todavía no hay actividad registrada esta semana.</Text> : <>
        <Text size="sm">{number(data.totals.purchases)} compras registradas · {number(data.totals.awards)} abonos con {number(data.totals.points_awarded)} puntos antes de reversiones · {number(data.totals.adjustments)} {data.totals.adjustments === 1 ? 'ajuste manual' : 'ajustes manuales'} · {number(data.totals.reversals)} {data.totals.reversals === 1 ? 'reversión' : 'reversiones'}.</Text>
        {data.staff.length > 0 && <ActivityRows data={data} rows={data.staff}/>}
        {data.staff_total > data.staff.length && <Text size="sm" c="dimmed">Se muestran {number(data.staff.length)} de {number(data.staff_total)} personas por nombre. El total incluye a todo el equipo.</Text>}
        {data.sources.length > 0 && <div><Title order={3} mb="sm">Caja y otros orígenes</Title><ActivityRows data={data} rows={data.sources} source/></div>}
      </>}
      <Text size="sm" c="dimmed" maw="72ch">Una compra puede incluir un abono; no sumes ambas columnas como operaciones distintas. El volumen depende de turnos, sucursales y tareas. Este resumen no mide desempeño ni indica irregularidades. La caja se muestra aparte aunque use una cuenta del equipo.</Text>
      {data.adjustments_scope === 'excluded_no_recorded_branch' && <Text size="sm">Los ajustes manuales no guardan sucursal y se excluyen de esta vista. Selecciona todas las sucursales para revisarlos.</Text>}
      <Button component="a" href={activityHistoryHref(data)} variant="outline" mih={44} w="fit-content">Ver movimientos de esta semana</Button>
    </>}
  </Stack></section>;
}
