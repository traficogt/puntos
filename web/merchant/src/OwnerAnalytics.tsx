import {useState, type ReactNode} from 'react';
import {Accordion, Alert, Button, Group, List, NativeSelect, Progress, SimpleGrid, Stack, Table, Text, TextInput, Title} from '@mantine/core';
import {BarChart, LineChart} from '@mantine/charts';
import {apiUrl} from '/lib.js';
import {blockSession, isDemo} from './api.js';
import {money, number} from './ui.jsx';
import {merchantRegion} from './region.js';
import {request, useOwnerResource, failure, OwnerLoading, OwnerError, OwnerRestricted} from './owner-workspace';
import type {Branch, OwnerFailure, OwnerPageProps, OwnerRequest} from './owner-workspace';
import {
  attachmentFilename, benchmarkRows, cohortMatrix, currentMonthRange, executiveMetrics, executiveNarrative, formatters, IVA_FILENAME, ivaExportPath, ivaRangeIssue,
  maybe, num, rfmSegments, rfmTotal, suggestedActions, trendRows,
} from './owner-analytics-model';
import type {BranchPerformanceRow, ChurnResponse, CohortsResponse, DashboardResponse, RoiResponse} from './owner-analytics-model';

// Analytics suite (wave 15a). Plan feature `analytics` (NEGOCIO and EMPRESA); basic plans keep
// Reportes. Every figure is program-recorded activity in PuntosFieles: not the business's total
// sales, and never revenue caused by the program. Risk, RFM and cohorts come from the last
// background calculation; the recalculation controls live with the operations tools.
const TITLE = 'Analítica avanzada';
const periods = [{value: '30', label: 'Últimos 30 días'}, {value: '60', label: 'Últimos 60 días'}, {value: '90', label: 'Últimos 90 días'}];
const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? '—' : `${new Intl.NumberFormat(merchantRegion().locale, {maximumFractionDigits: digits}).format(value)}%`);
const signed = (value: number) => `${value > 0 ? '+' : ''}${pct(value)}`;
/** The comparison note: a signed change when the previous window had activity, otherwise the previous value itself. */
const delta = (growth: number | null, previous: string, days: number) => (growth === null ? `${previous} · sin variación porcentual` : `${signed(growth)} frente a los ${days} días previos`);
const shortDate = (day: string) => new Intl.DateTimeFormat(merchantRegion().locale, {day: 'numeric', month: 'short', timeZone: 'UTC'}).format(new Date(`${day}T12:00:00Z`));
const branchLabel = (row: Pick<BranchPerformanceRow, 'branch_name' | 'branch_code'>) => (row.branch_code ? `${row.branch_name} (${row.branch_code})` : row.branch_name);

function Tile({label, value, note}: {label: string; value: string; note?: string}) {
  return <div role="listitem" className="metric"><Text className="metric-value" fw={650}>{value}</Text><Text size="sm" c="dimmed">{label}</Text>{note && <Text size="xs" c="dimmed" mt={4}>{note}</Text>}</div>;
}
function Section({id, title, lead, aside, children}: {id: string; title: string; lead?: string; aside?: ReactNode; children: ReactNode}) {
  return <section aria-labelledby={id}><Group justify="space-between" align="start" wrap="wrap"><div><Title order={2} id={id}>{title}</Title>{lead && <Text size="sm" c="dimmed" mt={4} maw={760}>{lead}</Text>}</div>{aside}</Group><Stack gap="sm" mt="sm">{children}</Stack></section>;
}
interface Loaded<T> {loading: boolean; error: OwnerFailure | null; data: T | null}
function Ready<T>({resource, label, retry, children}: {resource: Loaded<T>; label: string; retry: () => void; children: (data: T) => ReactNode}) {
  if (resource.loading) return <OwnerLoading label={label}/>;
  if (resource.error) return <OwnerError error={resource.error} retry={retry}/>;
  return resource.data ? <>{children(resource.data)}</> : null;
}

/** Saves a text/blob the way a plain download link would, without leaving the page. */
function saveFile(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename; anchor.rel = 'noopener';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
/** Real mode streams the server's CSV (session cookie, server-named file); the preview builds the same file locally. */
export async function downloadIvaCsv(path: string, send: OwnerRequest, demo = isDemo): Promise<string> {
  if (demo) {
    const result = await send<{csv: string; filename?: string}>(path);
    const filename = result.filename || IVA_FILENAME;
    saveFile(new Blob([result.csv], {type: 'text/csv;charset=utf-8'}), filename);
    return filename;
  }
  const response = await fetch(apiUrl(path), {credentials: 'include', cache: 'no-store', headers: {Accept: 'text/csv'}});
  if (!response.ok) {
    if (response.status === 401) blockSession();
    let message = response.status === 403 ? 'Tu cuenta o el plan actual no permiten esta operación.' : `HTTP ${response.status}`;
    try {const body: unknown = await response.json(); if (body && typeof body === 'object' && typeof (body as {error?: unknown}).error === 'string') message = String((body as {error: string}).error);} catch {/* the status is the message */}
    throw Object.assign(new Error(message), {status: response.status});
  }
  const filename = attachmentFilename(response.headers.get('content-disposition'));
  saveFile(await response.blob(), filename);
  return filename;
}

function IvaExport({send}: {send: OwnerRequest}) {
  const [range, setRange] = useState(() => currentMonthRange(new Date(), merchantRegion().timezone));
  const [state, setState] = useState<{busy: boolean; error: OwnerFailure | null; issue: string | null; done: string}>({busy: false, error: null, issue: null, done: ''});
  async function download() {
    const issue = ivaRangeIssue(range.from, range.to);
    if (issue) {setState({busy: false, error: null, issue, done: ''}); return;}
    setState({busy: true, error: null, issue: null, done: ''});
    try {
      const filename = await downloadIvaCsv(ivaExportPath(range.from, range.to), send);
      setState({busy: false, error: null, issue: null, done: `Archivo ${filename} descargado.`});
    } catch (cause) {
      setState({busy: false, error: failure(cause), issue: null, done: ''});
    }
  }
  return <Section id="owner-analytics-iva" title="Facturación local (IVA 12 %)" lead="Ventas registradas por día con la base sin IVA y el IVA de 12 % calculados a partir del monto bruto. Es un apoyo para la revisión contable en Guatemala; no sustituye los registros fiscales del negocio.">
    <Group align="end">
      <TextInput type="date" label="Desde" value={range.from} onChange={event => setRange(current => ({...current, from: event.currentTarget.value}))} disabled={state.busy} w={180}/>
      <TextInput type="date" label="Hasta" value={range.to} onChange={event => setRange(current => ({...current, to: event.currentTarget.value}))} disabled={state.busy} w={180}/>
      <Button onClick={download} loading={state.busy}>Descargar CSV IVA</Button>
    </Group>
    <Text size="xs" c="dimmed">Deja una fecha vacía para no acotar por ese lado. El archivo lleva las columnas fecha, transacciones, monto_bruto_q, base_sin_iva_q e iva_12_q.</Text>
    {state.issue && <Alert color="red" role="alert">{state.issue}</Alert>}
    {state.error && <OwnerError error={state.error}/>}
    {state.done && <Alert color="green" role="status">{state.done}</Alert>}
  </Section>;
}

export default function OwnerAnalytics({staff, features, onNavigate, request: send = request}: OwnerPageProps) {
  const [branch, setBranch] = useState(''), [days, setDays] = useState('30'), [revision, setRevision] = useState(0);
  const allowed = staff.role === 'OWNER' && features.analytics === true;
  const branchQuery = branch ? `?branch_id=${encodeURIComponent(branch)}` : '';
  const branches = useOwnerResource<{branches: Branch[]}>(allowed && features.multi_branch ? '/api/admin/branches' : null, revision, send);
  const dashboard = useOwnerResource<DashboardResponse>(allowed ? `/api/admin/analytics/dashboard${branchQuery}` : null, revision, send);
  const global = useOwnerResource<DashboardResponse>(allowed && branch ? '/api/admin/analytics/dashboard' : null, revision, send);
  const churn = useOwnerResource<ChurnResponse>(allowed ? `/api/admin/analytics/churn-risk?limit=10${branch ? `&branch_id=${encodeURIComponent(branch)}` : ''}` : null, revision, send);
  const cohorts = useOwnerResource<CohortsResponse>(allowed ? '/api/admin/analytics/cohorts?months=12' : null, revision, send);
  const roi = useOwnerResource<RoiResponse>(allowed ? `/api/admin/roi?days=${days}` : null, revision, send);
  // The executive tiles always read the 30-day window, whatever the comparison selector shows.
  const roi30 = useOwnerResource<RoiResponse>(allowed && days !== '30' ? '/api/admin/roi?days=30' : null, revision, send);
  const executiveRoi = days === '30' ? roi : roi30;
  if (!allowed) return <OwnerRestricted title={TITLE} owner={staff.role === 'OWNER'}/>;
  const refresh = () => setRevision(value => value + 1);
  const format = formatters(merchantRegion().locale);
  const branchRows = branches.data?.branches ?? [];
  const scopeLabel = branch ? branchRows.find(row => row.id === branch)?.name ?? 'Sucursal seleccionada' : 'Todas las sucursales';
  const canFilter = (id: string) => branchRows.some(row => row.id === id);
  const summaryReady = !dashboard.loading && !dashboard.error && dashboard.data;
  const metrics = executiveMetrics({summary: dashboard.data?.summary, roi: executiveRoi.data?.roi, branchPerformance: dashboard.data?.branch_performance, branchId: branch || null, riskCount: dashboard.data ? num(dashboard.data.summary.high_churn_risk_count) : churn.data?.count ?? 0});
  const trend = trendRows(dashboard.data?.recent_activity);
  const benchmark = branch ? benchmarkRows(dashboard.data?.recent_activity, global.data?.recent_activity) : [];
  const segments = rfmSegments(dashboard.data?.rfm_distribution);
  const matrix = cohortMatrix(cohorts.data?.cohorts);
  return <Stack gap="xl">
    <Group justify="space-between" align="start">
      <div><Title order={1}>{TITLE}</Title><Text c="dimmed" mt="sm" maw={760}>Lectura detallada de los últimos 30 días: clientes, segmentos, sucursales, cohortes y riesgo de pérdida. Son clientes y movimientos registrados en PuntosFieles, no el total de ventas del negocio ni ingresos causados por el programa.</Text></div>
      <Button variant="outline" onClick={refresh} loading={dashboard.loading}>Actualizar</Button>
    </Group>
    <Group align="end">
      {features.multi_branch && <NativeSelect label="Sucursal" data={[{value: '', label: 'Todas las sucursales'}, ...branchRows.map(row => ({value: row.id, label: row.name}))]} value={branch} onChange={event => setBranch(event.currentTarget.value)} disabled={branches.loading || !!branches.error} w={260}/>}
      <Text size="sm" fw={500}>Vista actual: {scopeLabel}</Text>
    </Group>
    {branches.error && <Text size="sm">No pudimos cargar las sucursales. La analítica muestra todas las sucursales.</Text>}

    <Section id="owner-analytics-summary" title="Resumen ejecutivo" lead="Narrativa de 30 días con las lecturas tal como el servidor las midió. Cuando filtras una sucursal, las ventas comparadas y la tasa de canje siguen siendo globales.">
      <Ready resource={dashboard} label="Cargando resumen…" retry={refresh}>{data => <>
        <Text>{executiveNarrative(scopeLabel, metrics, branch || null, format)}</Text>
        <SimpleGrid cols={{base: 2, sm: 3, lg: 6}} spacing="md" role="list" aria-label="Indicadores de 30 días">
          <Tile label="Clientes totales" value={format.count(metrics.totalCustomers)} note={branch ? 'Con compras en la sucursal' : 'Base medida del negocio'}/>
          <Tile label="Clientes activos (30 d)" value={format.count(metrics.activeCustomers)} note={executiveRoi.loading && !branch ? 'Consultando…' : metrics.activeCustomers === null ? 'Sin lectura' : branch ? 'Con compras en la sucursal' : 'Con visita o alta en 30 días'}/>
          <Tile label="Nuevos (30 d)" value={format.count(metrics.newCustomers)} note="Sin contar importados"/>
          <Tile label="En riesgo alto" value={format.count(num(data.summary.high_churn_risk_count))} note="Puntaje de riesgo ≥ 0.7"/>
          <Tile label="Gasto promedio" value={money(num(data.summary.avg_customer_spend))} note="Acumulado por cliente"/>
          <Tile label="Frecuencia de compra" value={`${number(metrics.purchaseFrequency)}×`} note="Promedio mensual por cliente"/>
        </SimpleGrid>
        <Title order={3} mt="xs">Sugerencias</Title>
        <List spacing={4}>{suggestedActions(metrics, branch || null, format).map(action => <List.Item key={action}>{action}</List.Item>)}</List>
        <Text size="xs" c="dimmed">Son sugerencias a partir de los indicadores de arriba; no miden el efecto del programa.</Text>
        {onNavigate && metrics.riskCount > 0 && <Group><Button variant="default" onClick={() => onNavigate('recovery')}>Abrir Recuperar clientes</Button></Group>}
      </>}</Ready>
    </Section>

    <Section id="owner-analytics-comparison" title={`Comparativo de ${days} días`} lead="Movimientos registrados en la ventana elegida frente a la ventana anterior del mismo largo, para todo el negocio." aside={<NativeSelect label="Ventana" data={periods} value={days} onChange={event => setDays(event.currentTarget.value)} w={200}/>}>
      <Ready resource={roi} label="Cargando comparativo…" retry={refresh}>{data => <SimpleGrid cols={{base: 2, sm: 3, lg: 5}} spacing="md" role="list" aria-label={`Comparativo de ${data.days} días`}>
        <Tile label="Ventas registradas" value={money(num(data.roi.revenue_current_q))} note={delta(maybe(data.roi.revenue_growth_pct), `Antes: ${money(num(data.roi.revenue_previous_q))}`, data.days)}/>
        <Tile label="Compras registradas" value={format.count(num(data.roi.tx_current))} note={delta(maybe(data.roi.tx_growth_pct), `Antes: ${format.count(num(data.roi.tx_previous))}`, data.days)}/>
        <Tile label="Clientes activos sobre la base" value={pct(num(data.roi.repeat_rate_pct))} note={`${format.count(num(data.roi.customers_active))} de ${format.count(num(data.roi.customers_total))} con visita en la ventana`}/>
        <Tile label="Canjes" value={format.count(num(data.roi.redemptions))} note="Entregas de recompensas"/>
        <Tile label="Tasa de canje" value={pct(num(data.roi.redemption_rate_pct))} note="Canjes por cada 100 compras registradas"/>
      </SimpleGrid>}</Ready>
    </Section>

    <Section id="owner-analytics-trend" title="Tendencia de ventas registradas (30 días)" lead="Importes de compras registradas por día; los mismos datos están en la tabla.">
      <Ready resource={dashboard} label="Cargando tendencia…" retry={refresh}>{() => !trend.length ? <Text>No hay actividad reciente para graficar.</Text> : <>
        <LineChart h={260} data={trend} dataKey="date" series={[{name: 'revenue', label: 'Ventas registradas', color: 'terra.6'}]} curveType="linear" withDots={trend.length <= 7} withLegend={false} valueFormatter={value => money(value)} xAxisProps={{tickFormatter: (value: string) => String(value).slice(5)}} yAxisProps={{width: 70}} role="img" aria-label="Ventas registradas por día; los mismos datos están disponibles en la tabla."/>
        <Accordion variant="default"><Accordion.Item value="trend"><Accordion.Control>Ver los datos del gráfico</Accordion.Control><Accordion.Panel>
          <Table.ScrollContainer minWidth={480} type="native" tabIndex={0} role="region" aria-label="Datos de la tendencia"><Table captionSide="top"><Table.Caption>Compras, clientes y ventas registradas por fecha</Table.Caption><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col" ta="right">Compras</Table.Th><Table.Th scope="col" ta="right">Clientes</Table.Th><Table.Th scope="col" ta="right">Ventas</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{trend.map(row => <Table.Tr key={row.date}><Table.Td>{row.date}</Table.Td><Table.Td ta="right">{format.count(row.transactions)}</Table.Td><Table.Td ta="right">{format.count(row.active_customers)}</Table.Td><Table.Td ta="right">{money(row.revenue)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
        </Accordion.Panel></Accordion.Item></Accordion>
      </>}</Ready>
    </Section>

    {branch && <Section id="owner-analytics-benchmark" title="Sucursal frente al negocio" lead="Ventas registradas de la sucursal filtrada junto al total del negocio en los últimos días con actividad.">
      {global.loading ? <OwnerLoading label="Comparando con el negocio…"/> : global.error ? <OwnerError error={global.error} retry={refresh}/> : !benchmark.length ? <Text>Sin datos comparables en los últimos días.</Text> : <Table.ScrollContainer minWidth={520} type="native" tabIndex={0} role="region" aria-label="Sucursal frente al negocio por día"><Table><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col" ta="right">{scopeLabel}</Table.Th><Table.Th scope="col" ta="right">Todo el negocio</Table.Th><Table.Th scope="col" ta="right">Participación</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{benchmark.map(row => <Table.Tr key={row.date}><Table.Td>{shortDate(row.date)}</Table.Td><Table.Td ta="right">{money(row.branch)}</Table.Td><Table.Td ta="right">{money(row.global)}</Table.Td><Table.Td ta="right" fw={600}>{row.sharePct}%</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </Section>}

    <Section id="owner-analytics-rfm" title="Segmentos RFM" lead="Recencia, frecuencia y monto de compra, puntuados de 1 a 5 cada uno frente al resto de tus clientes; la suma (3 a 15) define el segmento.">
      <Ready resource={dashboard} label="Cargando segmentos…" retry={refresh}>{() => rfmTotal(segments) === 0 ? <Text>No hay datos RFM todavía.</Text> : <>
        <BarChart h={200} data={segments.map(segment => ({label: segment.label, count: segment.count}))} dataKey="label" orientation="vertical" series={[{name: 'count', label: 'Clientes', color: 'terra.6'}]} withLegend={false} valueFormatter={value => format.count(value)} yAxisProps={{width: 90}} role="img" aria-label="Clientes por segmento RFM; la lista debajo tiene los mismos datos."/>
        <Table.ScrollContainer minWidth={420} type="native" tabIndex={0} role="region" aria-label="Clientes por segmento RFM"><Table><Table.Thead><Table.Tr><Table.Th scope="col">Segmento</Table.Th><Table.Th scope="col">Puntaje</Table.Th><Table.Th scope="col" ta="right">Clientes</Table.Th><Table.Th scope="col" ta="right">Participación</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{segments.filter(segment => segment.count > 0 || segment.range).map(segment => <Table.Tr key={segment.key}><Table.Td fw={600}>{segment.label}</Table.Td><Table.Td>{segment.range || '—'}</Table.Td><Table.Td ta="right">{format.count(segment.count)}</Table.Td><Table.Td ta="right">{pct(segment.sharePct)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
      </>}</Ready>
    </Section>

    <Section id="owner-analytics-branches" title="Rendimiento por sucursal (30 días)" lead="Ventas, compras, clientes activos y canjes registrados en cada sucursal. Filtra una sucursal para ver su propio resumen.">
      <Ready resource={dashboard} label="Cargando sucursales…" retry={refresh}>{data => !data.branch_performance?.length ? <Text>No hay sucursales o no hay actividad reciente.</Text> : <>
        {data.branch_performance.length > 1 && <BarChart h={60 + data.branch_performance.length * 36} data={data.branch_performance.map(row => ({label: branchLabel(row), revenue: num(row.revenue_30d)}))} dataKey="label" orientation="vertical" series={[{name: 'revenue', label: 'Ventas registradas', color: 'terra.6'}]} withLegend={false} valueFormatter={value => money(value)} yAxisProps={{width: 140}} role="img" aria-label="Ventas registradas por sucursal; la tabla tiene los mismos datos."/>}
        <Table.ScrollContainer minWidth={720} type="native" tabIndex={0} role="region" aria-label="Rendimiento por sucursal"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Sucursal</Table.Th><Table.Th scope="col" ta="right">Ventas</Table.Th><Table.Th scope="col" ta="right">Compras</Table.Th><Table.Th scope="col" ta="right">Clientes activos</Table.Th><Table.Th scope="col" ta="right">Canjes</Table.Th><Table.Th scope="col" ta="right">Ticket promedio</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.branch_performance.map(row => <Table.Tr key={row.branch_id}><Table.Td fw={600}>{branchLabel(row)}</Table.Td><Table.Td ta="right">{money(num(row.revenue_30d))}</Table.Td><Table.Td ta="right">{format.count(num(row.tx_30d))}</Table.Td><Table.Td ta="right">{format.count(num(row.active_customers_30d))}</Table.Td><Table.Td ta="right">{format.count(num(row.redemptions_30d))}</Table.Td><Table.Td ta="right">{money(num(row.avg_ticket_30d))}</Table.Td><Table.Td>{canFilter(row.branch_id) && (branch === row.branch_id ? <Button variant="subtle" size="compact-sm" onClick={() => setBranch('')}>Quitar filtro</Button> : <Button variant="default" size="compact-sm" aria-label={`Filtrar por ${row.branch_name}`} onClick={() => setBranch(row.branch_id)}>Filtrar</Button>)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
      </>}</Ready>
    </Section>

    <Section id="owner-analytics-cohorts" title="Cohortes de retención" lead="Clientes agrupados por el mes de su primera compra; cada celda es el porcentaje de esa cohorte que registró alguna compra n meses después.">
      <Ready resource={cohorts} label="Cargando cohortes…" retry={refresh}>{() => !matrix.cohorts.length ? <Text>Aún no hay cohortes calculadas. Aparecen tras el siguiente cálculo en segundo plano.</Text> : <Table.ScrollContainer minWidth={520} type="native" tabIndex={0} role="region" aria-label="Retención por cohorte mensual"><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th scope="col">Cohorte</Table.Th><Table.Th scope="col" ta="right">Clientes</Table.Th>{matrix.months.map(month => <Table.Th key={month} scope="col" ta="right">{month === 0 ? 'Mes 0' : `+${month} m`}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{matrix.cohorts.map(line => <Table.Tr key={line.name}><Table.Td fw={600}>{line.name}</Table.Td><Table.Td ta="right">{format.count(line.size)}</Table.Td>{line.cells.map(cell => <Table.Td key={cell.month} ta="right">{cell.pending ? <Text size="sm" c="dimmed" component="span" aria-label="Mes aún no iniciado">—</Text> : <><Text size="sm" component="span" fw={cell.month === 0 ? 600 : 400}>{pct(cell.rate, 0)}</Text><Progress size="xs" mt={4} value={Math.min(100, cell.rate)} aria-hidden="true"/></>}</Table.Td>)}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</Ready>
      <Text size="xs" c="dimmed">Un guion marca meses que todavía no empiezan. El mes en curso es parcial.</Text>
    </Section>

    <Section id="owner-analytics-churn" title="Clientes en riesgo de pérdida" lead="Los diez clientes con mayor puntaje de riesgo (0.7 o más). El puntaje combina los días desde la última compra y la frecuencia de compra; es una estimación, no una predicción comprobada.">
      <Ready resource={churn} label="Cargando clientes en riesgo…" retry={refresh}>{data => !data.customers.length ? <Text>Ningún cliente supera el umbral de riesgo en esta vista.</Text> : <Table.ScrollContainer minWidth={640} type="native" tabIndex={0} role="region" aria-label="Clientes en riesgo de pérdida"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Cliente</Table.Th><Table.Th scope="col" ta="right">Días sin visitar</Table.Th><Table.Th scope="col" ta="right">Riesgo</Table.Th><Table.Th scope="col" ta="right">Visitas</Table.Th><Table.Th scope="col" ta="right">Gasto registrado</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.customers.map(customer => <Table.Tr key={customer.id}><Table.Td><Text fw={600}>{customer.name || customer.phone}</Text>{customer.name && <Text size="xs" c="dimmed">{customer.phone}</Text>}</Table.Td><Table.Td ta="right">{customer.days_since_last_purchase === null || customer.days_since_last_purchase === undefined ? '—' : format.count(num(customer.days_since_last_purchase))}</Table.Td><Table.Td ta="right"><Text component="span" fw={600}>{pct(num(customer.churn_risk_score) * 100, 0)}</Text></Table.Td><Table.Td ta="right">{format.count(num(customer.total_visits))}</Table.Td><Table.Td ta="right">{money(num(customer.total_spend))}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</Ready>
      {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('recovery')}>Preparar una lista de regreso</Button><Button variant="subtle" onClick={() => onNavigate('automations')}>Notificaciones automáticas</Button></Group>}
    </Section>

    <IvaExport send={send}/>

    {summaryReady && <Accordion variant="default"><Accordion.Item value="definitions"><Accordion.Control>Qué significan estos números</Accordion.Control><Accordion.Panel><Stack gap="sm">
      <Text size="sm">Clientes totales: clientes registrados del negocio que no han sido eliminados; con una sucursal filtrada, los clientes con compras registradas en esa sucursal. Nuevos (30 d): clientes creados en los últimos 30 días, sin contar importaciones.</Text>
      <Text size="sm">Clientes activos (30 d): para todo el negocio, clientes con una visita o alta en la ventana del comparativo; para una sucursal, clientes distintos con compras registradas ahí en 30 días. Dividirlos entre los clientes totales da la lectura de la narrativa; no es una medición de retención entre cohortes.</Text>
      <Text size="sm">En riesgo alto: clientes con puntaje de riesgo de 0.7 o más. El puntaje pesa 60 % los días desde la última compra (sobre 90 días) y 40 % la frecuencia de compra. Gasto promedio y frecuencia de compra son promedios por cliente del acumulado histórico y de compras mensuales, según el último cálculo en segundo plano.</Text>
      <Text size="sm">Ventas registradas: importes de compras recibidas por PuntosFieles. La tendencia y las sucursales excluyen migraciones y saldos iniciales; el comparativo cuenta todos los movimientos de la ventana y de la ventana anterior del mismo largo, hasta la misma hora. No representan todas las ventas del negocio ni ingresos causados por el programa.</Text>
      <Text size="sm">Tasa de canje: canjes entregados por cada 100 compras registradas en la ventana. Sin costos y una comparación controlada, no calculamos rentabilidad ni retorno de inversión.</Text>
      <Text size="sm">Segmentos RFM: cada cliente recibe de 1 a 5 puntos por recencia, frecuencia y monto comparado con los quintiles del propio negocio; Campeones suman 12 a 15, Leales 9 a 11, En riesgo 6 a 8 y Perdidos 3 a 5. Cohortes: clientes agrupados por el mes de su primera compra registrada; cada celda divide los que compraron n meses después entre el tamaño de la cohorte.</Text>
      <Text size="sm">Riesgo, segmentos y cohortes se recalculan en segundo plano y pueden ir unas horas por detrás de las compras. Los datos pueden cambiar al sincronizar compras o procesar devoluciones.</Text>
      {isDemo && <Text size="sm">Datos ficticios de demostración. No corresponden a clientes, ventas ni resultados reales.</Text>}
    </Stack></Accordion.Panel></Accordion.Item></Accordion>}
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('redemptions')}>Canjes por recompensa</Button><Button variant="subtle" onClick={() => onNavigate('reports')}>Reportes básicos</Button></Group>}
  </Stack>;
}
