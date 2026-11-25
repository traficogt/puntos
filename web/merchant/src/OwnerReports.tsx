import {useState} from 'react';
import {Anchor, Button, Group, NativeSelect, Progress, SimpleGrid, Stack, Text, Title} from '@mantine/core';
import {money} from './ui.jsx';
import {merchantRegion} from './region.js';
import {request, useOwnerResource, OwnerLoading, OwnerError, OwnerRestricted} from './owner-workspace';
import type {Branch, OwnerPageProps} from './owner-workspace';

// GET /api/admin/analytics/overview (basic_reporting, every plan). Recorded program activity only:
// not the business's total sales, and never revenue caused by the program.
export interface OverviewMetrics {recorded_sales_q: number; purchases: number; active_customers: number; repeat_customers: number; repeat_rate_pct: number | null; average_ticket_q: number; redemptions: number}
export interface OverviewResponse {ok: boolean; current: OverviewMetrics; previous?: OverviewMetrics; rewards?: {name: string; redemptions: number; points_redeemed: number}[]; period?: {days: number; start: string; end: string}; notes?: string[]}
const periods = [{value: '7', label: 'Últimos 7 días'}, {value: '30', label: 'Últimos 30 días'}, {value: '90', label: 'Últimos 90 días'}];
const count = (value: number | string | null | undefined) => new Intl.NumberFormat(merchantRegion().locale, {maximumFractionDigits: 0}).format(Number(value) || 0);
const UNLIMITED = 999999;

/** Soft-cap headroom copy. The cap never blocks a sale at the counter; this is where the owner sees room left. */
export function planUsage(used: number | null | undefined, limit: number | undefined) {
  if (used == null || !Number.isFinite(Number(limit)) || Number(limit) <= 0) return null;
  const cap = Number(limit), unlimited = cap >= UNLIMITED, pct = unlimited ? 0 : Math.round((used / cap) * 100);
  const title = unlimited ? `${count(used)} clientes activos (sin límite en tu plan)` : `${count(used)} de ${count(cap)} clientes activos (${pct}%)`;
  const note = unlimited || pct < 80
    ? 'Clientes con visita o inscripción en los últimos 90 días.' + (unlimited ? '' : ' Tu plan tiene holgura.')
    : pct > 100
      ? 'Superaste el límite de clientes activos de tu plan. Tu programa sigue funcionando con normalidad y ningún cliente es rechazado en caja; para seguir creciendo con holgura, considera el siguiente plan.'
      : 'Te estás acercando al límite de clientes activos de tu plan. Nada se bloquea en caja; es un buen momento para revisar el siguiente plan.';
  return {title, note, pct: Math.min(100, Math.max(0, pct)), unlimited, suggestUpgrade: !unlimited && pct >= 80};
}

export default function OwnerReports({staff, features, limits, usage, onNavigate, request: send = request}: OwnerPageProps) {
  const [days, setDays] = useState('30'), [branch, setBranch] = useState(''), [revision, setRevision] = useState(0);
  const allowed = staff.role === 'OWNER' && features.basic_reporting === true;
  const branches = useOwnerResource<{branches: Branch[]}>(allowed && features.multi_branch ? '/api/admin/branches' : null, revision, send);
  const resource = useOwnerResource<OverviewResponse>(allowed ? `/api/admin/analytics/overview?days=${days}${branch ? `&branch_id=${encodeURIComponent(branch)}` : ''}` : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Reportes" owner={staff.role === 'OWNER'}/>;
  const current = resource.data?.current, rewards = resource.data?.rewards ?? [];
  const capacity = planUsage(usage?.active_customers, limits?.activeCustomers);
  const tiles: [string, string][] = current ? [
    ['Clientes activos', count(current.active_customers)],
    ['Clientes que volvieron', count(current.repeat_customers)],
    ['Tasa de regreso', current.repeat_rate_pct == null ? '—' : `${Number(current.repeat_rate_pct).toFixed(0)}%`],
    ['Compras registradas', count(current.purchases)],
    ['Ventas registradas', money(current.recorded_sales_q || 0)],
    ['Ticket promedio', money(current.average_ticket_q || 0)],
    ['Premios usados', count(current.redemptions)],
  ] : [];
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Reportes</Title><Text c="dimmed" mt="sm" maw={740}>Resumen de participación de tu programa. Son clientes y compras registradas en PuntosFieles, no el total de ventas del negocio ni ingresos causados por el programa.</Text></div><Button variant="outline" onClick={() => setRevision(value => value + 1)} loading={resource.loading}>Actualizar</Button></Group>
    <Group align="end">
      <NativeSelect label="Período" data={periods} value={days} onChange={event => setDays(event.currentTarget.value)} w={200}/>
      {features.multi_branch && <NativeSelect label="Sucursal" data={[{value: '', label: 'Todas las sucursales'}, ...(branches.data?.branches ?? []).map(row => ({value: row.id, label: row.name}))]} value={branch} onChange={event => setBranch(event.currentTarget.value)} disabled={branches.loading || !!branches.error} w={240}/>}
    </Group>
    {branches.error && <Text size="sm">No pudimos cargar las sucursales. El reporte muestra todas las sucursales.</Text>}
    {resource.loading ? <OwnerLoading label="Cargando reporte…"/> : resource.error ? <OwnerError error={resource.error} retry={() => setRevision(value => value + 1)}/> : current && <>
      <SimpleGrid cols={{base: 2, sm: 3, lg: 4}} spacing="md" role="list" aria-label="Indicadores del período">{tiles.map(([label, value]) => <div key={label} role="listitem" className="metric"><Text className="metric-value" fw={650}>{value}</Text><Text size="sm" c="dimmed">{label}</Text></div>)}</SimpleGrid>
      <section aria-labelledby="owner-report-rewards"><Title order={2} id="owner-report-rewards">Premios</Title>{!rewards.length ? <Text mt="sm">Aún no hay premios canjeados en el período.</Text> : <Stack gap={4} mt="sm">{rewards.slice(0, 5).map(reward => <Text key={reward.name} size="sm">{reward.name || 'Premio'} · {count(reward.redemptions)} usos · {count(reward.points_redeemed)} puntos</Text>)}</Stack>}</section>
      {resource.data?.notes?.map(note => <Text key={note} size="xs" c="dimmed">{note}</Text>)}
    </>}
    <section aria-labelledby="owner-report-capacity"><Title order={2} id="owner-report-capacity">Capacidad del plan</Title>{!capacity ? <Text mt="sm">Capacidad del plan no disponible por el momento.</Text> : <Stack gap="xs" mt="sm" maw={640}><Text fw={600}>{capacity.title}</Text>{!capacity.unlimited && <Progress value={capacity.pct} aria-label="Clientes activos frente al límite del plan"/>}<Text size="sm">{capacity.note}</Text>{capacity.suggestUpgrade && <Anchor href="/precios" target="_blank" rel="noopener">Ver planes</Anchor>}</Stack>}</section>
    {onNavigate && features.analytics && <Group><Button variant="default" onClick={() => onNavigate('analytics')}>Abrir la analítica avanzada</Button><Button variant="subtle" onClick={() => onNavigate('overview')}>Ver el análisis completo en Inicio</Button></Group>}
  </Stack>;
}
