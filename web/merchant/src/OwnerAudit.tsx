import {useState} from 'react';
import {Badge, Button, Checkbox, Code, Group, Stack, Table, Text, TextInput, Title} from '@mantine/core';
import {apiUrl} from '/lib.js';
import {BusinessLink, money} from './ui.jsx';
import {request, useOwnerResource, OwnerLoading, OwnerError, OwnerRestricted, ownerDate, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';
import {auditActor, auditQuery, auditScope, impersonatedBy, inspectable, whole} from './owner-operations-model';
import type {AuditDetail, AuditEvent, AuditFilters, Numeric} from './owner-operations-model';

// GET /api/admin/audit (filters: from, to, impersonated_only), GET /api/admin/audit/:id for the linked
// transaction/redemption/gift card, and GET /api/admin/audit.csv. Owner only on the server; the vanilla
// analytics tab that hosted the timeline required the `analytics` plan feature, which this page keeps.
const LIMIT = 80;
const formatDay = (value: string) => ownerDate(`${value}T12:00:00Z`);
/** The vanilla detail box, line by line; `format` renders money so the helper stays free of UI imports. */
export function auditDetailLines(detail: AuditDetail, format: (value: Numeric) => string): string[] {
  const lines = [`Evento: ${detail.event.action}`, `Fecha: ${detail.event.created_at ? ownerDateTime(detail.event.created_at) : '—'}`, `Actor: ${auditActor(detail.event)}`];
  const linked = detail.linked ?? {};
  if (linked.transaction) lines.push(`Transacción: ${linked.transaction.id}`, `Cliente: ${linked.transaction.customer_name || '—'} · ${linked.transaction.customer_phone || '—'}`, `Origen: ${linked.transaction.source || '—'} · Estado: ${linked.transaction.status || '—'} · Puntos: ${whole(linked.transaction.points)}`);
  if (linked.reversal_transaction) lines.push(`Reversa: ${linked.reversal_transaction.id}`, `Estado: ${linked.reversal_transaction.status || '—'} · Puntos: ${whole(linked.reversal_transaction.points)} · Motivo: ${linked.reversal_transaction.reversal_reason || '—'}`);
  if (linked.redemption) lines.push(`Canje: ${linked.redemption.code} · ${linked.redemption.reward_name}`, `Cliente: ${linked.redemption.customer_name || '—'} · ${linked.redemption.customer_phone || '—'}`, `Costo: ${whole(linked.redemption.points_cost)} pts`);
  if (linked.gift_card) lines.push(`Tarjeta de regalo: ${linked.gift_card.code}`, `Saldo: ${format(linked.gift_card.balance_q)} · Estado: ${linked.gift_card.status || '—'}`);
  if (linked.gift_card_transaction) lines.push(`Movimiento de tarjeta: ${linked.gift_card_transaction.tx_type} · ${format(linked.gift_card_transaction.amount_q)} · saldo ${format(linked.gift_card_transaction.balance_after_q)}`);
  return lines;
}

function Detail({eventId, send, onClose}: {eventId: string; send: OwnerRequest; onClose: () => void}) {
  const [revision, setRevision] = useState(0);
  const resource = useOwnerResource<AuditDetail>(`/api/admin/audit/${encodeURIComponent(eventId)}`, revision, send);
  const detail = resource.data, meta = detail?.event.meta ?? {};
  return <Stack gap="sm" className="panel" p="md" aria-live="polite">
    <Group justify="space-between" align="start"><Title order={3}>Contexto del evento</Title><Button variant="subtle" size="compact-sm" onClick={onClose}>Cerrar detalle</Button></Group>
    {resource.loading ? <OwnerLoading label="Consultando el evento…"/> : resource.error ? <OwnerError error={resource.error} retry={() => setRevision(value => value + 1)}/> : detail && <>
      {auditDetailLines(detail, value => money(Number(value ?? 0))).map((line, index) => <Text key={`${index}-${line}`} size="sm">{line}</Text>)}
      {Object.keys(meta).length > 0 && <><Text size="sm" fw={600}>Meta</Text><Code block style={{overflowWrap: 'anywhere'}}>{JSON.stringify(meta, null, 2)}</Code></>}
    </>}
  </Stack>;
}

export default function OwnerAudit({staff, features, onNavigate, request: send = request}: OwnerPageProps) {
  const [filters, setFilters] = useState<AuditFilters>({from: '', to: '', impersonatedOnly: false}), [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const allowed = staff.role === 'OWNER' && features.analytics === true;
  const resource = useOwnerResource<{events: AuditEvent[]}>(allowed ? `/api/admin/audit${auditQuery(filters, LIMIT)}` : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Auditoría" owner={staff.role === 'OWNER'}/>;
  const rows = resource.data?.events ?? [];
  const refresh = () => setRevision(value => value + 1);
  const update = (patch: Partial<AuditFilters>) => {setFilters(current => ({...current, ...patch})); setSelected(null);};
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Auditoría</Title><Text c="dimmed" mt="sm" maw={760}>Quién hizo qué en tu programa: compras, canjes, reversas, cambios de configuración y acciones del soporte en modo impersonación. Los eventos no se pueden editar ni borrar.</Text></div><Button variant="outline" onClick={refresh} loading={resource.loading}>Actualizar</Button></Group>
    <Group align="end">
      <TextInput type="date" label="Desde" value={filters.from} max={filters.to || undefined} onChange={event => update({from: event.currentTarget.value})}/>
      <TextInput type="date" label="Hasta" value={filters.to} min={filters.from || undefined} onChange={event => update({to: event.currentTarget.value})}/>
      <Checkbox label="Solo acciones en impersonación" checked={filters.impersonatedOnly} onChange={event => update({impersonatedOnly: event.currentTarget.checked})} pb={8}/>
      <BusinessLink href={apiUrl(`/api/admin/audit.csv${auditQuery(filters, 5000)}`)} target="_blank" rel="noopener">Descargar CSV</BusinessLink>
    </Group>
    <Text size="sm" c="dimmed" role="status">{auditScope(filters, formatDay)}</Text>
    {resource.loading ? <OwnerLoading label="Consultando auditoría…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !rows.length ? <Text>{filters.impersonatedOnly ? 'Sin eventos recientes en modo impersonación.' : 'Sin eventos de auditoría recientes.'}</Text> : <Table.ScrollContainer minWidth={760} type="native" tabIndex={0} role="region" aria-label="Eventos de auditoría"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Actor</Table.Th><Table.Th scope="col">Acción</Table.Th><Table.Th scope="col">Contexto</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(event => {const impersonator = impersonatedBy(event); return <Table.Tr key={event.id}><Table.Td>{ownerDateTime(event.created_at)}</Table.Td><Table.Td>{auditActor(event)}</Table.Td><Table.Td><Text size="sm" ff="monospace">{event.action}</Text></Table.Td><Table.Td><Group gap="xs">{impersonator && <Badge variant="light" c="var(--mantine-color-text)" color="orange" title={`Ejecutado en modo impersonación por ${impersonator}`}>Impersonación</Badge>}{inspectable(event) && <Button variant="default" size="compact-sm" aria-label={`Ver detalle del evento ${event.action} del ${ownerDateTime(event.created_at)}`} aria-pressed={selected === event.id} onClick={() => setSelected(current => current === event.id ? null : event.id)}>{selected === event.id ? 'Ocultar detalle' : 'Ver detalle'}</Button>}</Group>{impersonator && <Text size="xs" c="dimmed">Ejecutado en modo impersonación por {impersonator}</Text>}</Table.Td></Table.Tr>;})}</Table.Tbody></Table></Table.ScrollContainer>}
    {selected ? <Detail key={selected} eventId={selected} send={send} onClose={() => setSelected(null)}/> : <Text size="sm" c="dimmed">Selecciona «Ver detalle» en un evento para ver su contexto operativo.</Text>}
    <Text size="xs" c="dimmed">Se muestran hasta {LIMIT} eventos del periodo; el CSV incluye hasta 5,000. Las acciones de la plataforma aparecen como «Plataforma» sin detalle interno.</Text>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('ledger')}>Conciliación del libro de puntos</Button></Group>}
  </Stack>;
}
