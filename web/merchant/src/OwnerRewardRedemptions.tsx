import {useState} from 'react';
import {Badge, Button, Group, NativeSelect, SimpleGrid, Stack, Table, Text, Title} from '@mantine/core';
import {money} from './ui.jsx';
import {request, useOwnerResource, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';
import {num, redemptionConsistent, redemptionStatusLabel, transactionSourceLabel} from './owner-analytics-model';
import type {RedemptionDetailResponse, RewardOption, RewardRedemptionsResponse} from './owner-analytics-model';

// Reward redemption ledger (wave 15a): GET /api/admin/rewards (feature `rewards`) for the selector,
// GET /api/admin/analytics/rewards/:id/redemptions for the latest twenty redemptions with their
// linked points, GET /api/admin/analytics/redemptions/:id for one redemption's movements. Both
// analytics routes sit behind the `analytics` plan feature. This is an audit reading, not a sales report.
const TITLE = 'Canjes por recompensa';
const points = (value: number | string | null | undefined) => `${new Intl.NumberFormat('es-GT', {maximumFractionDigits: 0}).format(num(value))} pts`;
export const rewardOptionLabel = (reward: RewardOption) => `${reward.name} · ${points(reward.points_cost)}${reward.active ? '' : ' (inactiva)'}`;
export const sortRewards = (rewards: RewardOption[]) => [...rewards].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));

function Consistency({consistent}: {consistent: boolean}) {
  return consistent ? <Text size="sm" component="span">Consistente</Text> : <Badge variant="light" color="red">Revisar</Badge>;
}

function Detail({id, send}: {id: string; send: OwnerRequest}) {
  const [revision, setRevision] = useState(0);
  const resource = useOwnerResource<RedemptionDetailResponse>(`/api/admin/analytics/redemptions/${encodeURIComponent(id)}`, revision, send);
  if (resource.loading) return <OwnerLoading label="Consultando el canje…"/>;
  if (resource.error) return <OwnerError error={resource.error} retry={() => setRevision(value => value + 1)}/>;
  if (!resource.data?.redemption || !resource.data.ledger) return null;
  const {redemption, ledger, transactions} = resource.data;
  return <Stack gap="sm" className="panel" p="md" aria-labelledby="owner-redemption-detail" component="section">
    <Group justify="space-between"><Title order={3} id="owner-redemption-detail">Canje {redemption.code}</Title>{ledger.consistent ? <Badge variant="default">Canje consistente</Badge> : <Badge variant="light" color="red">Revisar canje</Badge>}</Group>
    <SimpleGrid cols={{base: 1, sm: 2}} spacing="xs">
      <Text size="sm"><Text component="span" c="dimmed">Recompensa:</Text> {redemption.reward_name}</Text>
      <Text size="sm"><Text component="span" c="dimmed">Cliente:</Text> {redemption.customer_name || '—'} · {redemption.customer_phone || '—'}</Text>
      <Text size="sm"><Text component="span" c="dimmed">Fecha:</Text> {ownerDateTime(redemption.created_at)}</Text>
      <Text size="sm"><Text component="span" c="dimmed">Estado:</Text> {redemptionStatusLabel(redemption.status)}{redemption.staff_name ? ` · atendido por ${redemption.staff_name}` : ''}</Text>
    </SimpleGrid>
    <SimpleGrid cols={{base: 2, sm: 4}}>
      <div><Text size="sm" c="dimmed">Costo esperado</Text><Text fw={600}>{points(ledger.expected_points_total)}</Text></div>
      <div><Text size="sm" c="dimmed">Movimiento vinculado</Text><Text fw={600}>{points(ledger.linked_points_total)}</Text></div>
      <div><Text size="sm" c="dimmed">Diferencia</Text><Text fw={600}>{points(ledger.delta_points)}</Text></div>
      <div><Text size="sm" c="dimmed">Movimientos vinculados</Text><Text fw={600}>{ledger.linked_transaction_count}</Text></div>
    </SimpleGrid>
    {!ledger.consistent && <Text size="sm" fw={500}>Un canje consistente tiene exactamente un movimiento de puntos igual a su costo. Revisa este canje con soporte antes de corregir saldos.</Text>}
    {!transactions.length ? <Text size="sm">No hay movimientos de puntos vinculados a este canje.</Text> : <Table.ScrollContainer minWidth={560} type="native" tabIndex={0} role="region" aria-label={`Movimientos vinculados al canje ${redemption.code}`}><Table><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Origen</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col" ta="right">Puntos</Table.Th><Table.Th scope="col" ta="right">Monto</Table.Th><Table.Th scope="col">Reversa</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{transactions.map(tx => <Table.Tr key={tx.id}><Table.Td>{ownerDateTime(tx.created_at)}</Table.Td><Table.Td>{transactionSourceLabel(tx.source)}</Table.Td><Table.Td>{tx.status}</Table.Td><Table.Td ta="right">{points(tx.points)}</Table.Td><Table.Td ta="right">{money(num(tx.amount_q))}</Table.Td><Table.Td>{tx.reversal_reason || (tx.reversed_transaction_id ? 'Reversado' : '—')}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack>;
}

export default function OwnerRewardRedemptions({staff, features, onNavigate, request: send = request}: OwnerPageProps) {
  const [rewardId, setRewardId] = useState(''), [selected, setSelected] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const allowed = staff.role === 'OWNER' && features.analytics === true && features.rewards !== false;
  const rewards = useOwnerResource<{rewards: RewardOption[]}>(allowed ? '/api/admin/rewards' : null, revision, send);
  const redemptions = useOwnerResource<RewardRedemptionsResponse>(allowed && rewardId ? `/api/admin/analytics/rewards/${encodeURIComponent(rewardId)}/redemptions` : null, revision, send);
  if (!allowed) return <OwnerRestricted title={TITLE} owner={staff.role === 'OWNER'}/>;
  const options = sortRewards(rewards.data?.rewards ?? []);
  const refresh = () => setRevision(value => value + 1);
  const rows = redemptions.data?.recent_redemptions ?? [];
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>{TITLE}</Title><Text c="dimmed" mt="sm" maw={760}>Revisa los últimos veinte canjes de una recompensa y comprueba que cada uno descontó exactamente su costo en puntos. Es una lectura de auditoría del ledger de puntos, no un reporte de ventas.</Text></div><Button variant="outline" onClick={refresh} loading={rewards.loading || redemptions.loading}>Actualizar</Button></Group>
    {rewards.loading ? <OwnerLoading label="Cargando recompensas…"/> : rewards.error ? <OwnerError error={rewards.error} retry={refresh}/> : !options.length ? <Text>Todavía no hay recompensas. Crea la primera en Recompensas y catálogo.</Text> : <NativeSelect label="Recompensa" data={[{value: '', label: 'Elige una recompensa'}, ...options.map(reward => ({value: reward.id, label: rewardOptionLabel(reward)}))]} value={rewardId} onChange={event => {setRewardId(event.currentTarget.value); setSelected(null);}} w={360}/>}
    {rewardId && (redemptions.loading ? <OwnerLoading label="Buscando canjes recientes…"/> : redemptions.error ? <OwnerError error={redemptions.error} retry={refresh}/> : redemptions.data && <section aria-labelledby="owner-redemptions-list">
      <Group justify="space-between" align="start"><Title order={2} id="owner-redemptions-list">Últimos canjes de {redemptions.data.reward.name}</Title><Group gap="xs"><Badge variant="light" color="gray">{redemptions.data.summary.recent_redemption_count} recientes</Badge><Badge variant={redemptions.data.summary.mismatch_count > 0 ? 'light' : 'default'} color={redemptions.data.summary.mismatch_count > 0 ? 'red' : undefined}>{redemptions.data.summary.mismatch_count} por revisar</Badge></Group></Group>
      {!rows.length ? <Text mt="sm">No hay canjes recientes para esta recompensa.</Text> : <Table.ScrollContainer minWidth={840} type="native" tabIndex={0} role="region" aria-label={`Canjes recientes de ${redemptions.data.reward.name}`} mt="sm"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Código</Table.Th><Table.Th scope="col">Cliente</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col" ta="right">Costo</Table.Th><Table.Th scope="col" ta="right">Descontado</Table.Th><Table.Th scope="col">Ledger</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={row.id}><Table.Td>{ownerDateTime(row.created_at)}</Table.Td><Table.Td fw={600}>{row.code}</Table.Td><Table.Td>{row.customer_name || row.customer_phone}</Table.Td><Table.Td>{redemptionStatusLabel(row.status)}</Table.Td><Table.Td ta="right">{points(row.points_cost)}</Table.Td><Table.Td ta="right">{points(row.linked_points_total)}<Text size="xs" c="dimmed">{num(row.linked_transaction_count)} mov.</Text></Table.Td><Table.Td><Consistency consistent={redemptionConsistent(row)}/></Table.Td><Table.Td><Button variant="default" size="compact-sm" aria-label={`Ver detalle del canje ${row.code}`} aria-pressed={selected === row.id} onClick={() => setSelected(current => current === row.id ? null : row.id)}>{selected === row.id ? 'Ocultar detalle' : 'Ver detalle'}</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </section>)}
    {selected && <Detail key={`${selected}:${revision}`} id={selected} send={send}/>}
    <Text size="xs" c="dimmed">Consistente significa que el canje tiene exactamente un movimiento de puntos vinculado igual a su costo. Un canje reversado o uno registrado antes de que existiera el vínculo puede aparecer para revisar sin que falte saldo.</Text>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('fulfillment')}>Canjes y caja</Button><Button variant="subtle" onClick={() => onNavigate('analytics')}>Analítica avanzada</Button></Group>}
  </Stack>;
}
