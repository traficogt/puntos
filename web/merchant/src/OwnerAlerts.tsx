import {useState} from 'react';
import {Alert, Badge, Button, Group, Stack, Table, Text, TextInput, Title} from '@mantine/core';
import {money} from './ui.jsx';
import {request, useOwnerResource, useOwnerMutation, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';
import {alertDetail, alertTypeLabel, phoneIssue, severity} from './owner-operations-model';
import type {AlertRow, PaymentEvent, ResolvePaymentResponse} from './owner-operations-model';

// GET /api/admin/alerts (owner) and GET /api/admin/payment-webhooks?status=PENDING_MAPPING plus
// POST /api/admin/payment-webhooks/:id/resolve (owner or manager). Both lived in the vanilla analytics tab,
// so the page keeps that tab's `analytics` plan gate. Assigning a payment awards points, hence the confirmation.
export const assignConfirmation = (amount: string, phone: string) => `¿Asignar este pago de ${amount} al teléfono ${phone}? Se otorgarán al cliente los puntos de la compra y el pago dejará de aparecer como pendiente.`;

function AlertsCenter({send, revision, onRefresh}: {send: OwnerRequest; revision: number; onRefresh: () => void}) {
  const resource = useOwnerResource<{alerts: AlertRow[]}>('/api/admin/alerts?limit=60', revision, send);
  const rows = resource.data?.alerts ?? [];
  return <section aria-labelledby="owner-alerts-center"><Stack gap="md">
    <div><Title order={2} id="owner-alerts-center">Centro de alertas</Title><Text size="sm" c="dimmed">Compras marcadas como sospechosas, trabajos fallidos, webhooks sin entregar y pagos con problemas, en orden de llegada.</Text></div>
    {resource.loading ? <OwnerLoading label="Consultando alertas…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : !rows.length ? <Text>Sin alertas recientes.</Text> : <Table.ScrollContainer minWidth={720} type="native" tabIndex={0} role="region" aria-label="Alertas recientes"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Severidad</Table.Th><Table.Th scope="col">Tipo</Table.Th><Table.Th scope="col">Detalle</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => {const level = severity(row.severity); return <Table.Tr key={`${row.alert_type}-${row.id}`}><Table.Td>{ownerDateTime(row.created_at)}</Table.Td><Table.Td><Badge variant="light" c="var(--mantine-color-text)" color={level.color}>{level.label}</Badge></Table.Td><Table.Td>{alertTypeLabel(row.alert_type)}</Table.Td><Table.Td><Text size="sm" style={{overflowWrap: 'anywhere'}}>{alertDetail(row.details)}</Text></Table.Td></Table.Tr>;})}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack></section>;
}

function PendingPayments({send, revision, onRefresh}: {send: OwnerRequest; revision: number; onRefresh: () => void}) {
  const resource = useOwnerResource<{events: PaymentEvent[]}>('/api/admin/payment-webhooks?status=PENDING_MAPPING&limit=20', revision, send);
  const [phones, setPhones] = useState<Record<string, string>>({}), [issue, setIssue] = useState<{id: string; text: string} | null>(null), [message, setMessage] = useState('');
  const mutation = useOwnerMutation();
  const events = resource.data?.events ?? [];
  const phoneFor = (event: PaymentEvent) => phones[event.id] ?? (event.customer_phone ?? '');
  const assign = (event: PaymentEvent) => {
    const phone = phoneFor(event).trim(), problem = phoneIssue(phone);
    if (problem) {setIssue({id: event.id, text: problem}); return;}
    if (!window.confirm(assignConfirmation(money(Number(event.amount_q ?? 0)), phone))) return;
    setIssue(null); setMessage('');
    mutation.run(() => send<ResolvePaymentResponse>(`/api/admin/payment-webhooks/${encodeURIComponent(event.id)}/resolve`, {method: 'POST', body: JSON.stringify({customerPhone: phone})}), () => {setMessage('Pago asignado y puntos otorgados.'); onRefresh();});
  };
  return <section aria-labelledby="owner-pending-payments"><Stack gap="md">
    <div><Title order={2} id="owner-pending-payments">Pagos sin cliente</Title><Text size="sm" c="dimmed">Pagos que tu pasarela avisó por webhook sin un cliente reconocible. Al asignarlos a un teléfono registrado se otorgan los puntos de esa compra.</Text></div>
    {message && <Alert color="green" role="status">{message}</Alert>}
    {mutation.error && <OwnerError error={mutation.error}/>}
    {resource.loading ? <OwnerLoading label="Consultando pagos pendientes…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : !events.length ? <Text>No hay pagos pendientes por asignar.</Text> : <Stack gap="md">{events.map(event => {const reference = event.provider_event_id || event.id; return <Stack key={event.id} className="panel" p="md" gap="sm">
      <Group justify="space-between" align="start"><div><Text fw={600}>{money(Number(event.amount_q ?? 0))} · {event.provider || 'proveedor'}</Text><Text size="sm" c="dimmed">{ownerDateTime(event.created_at)} · Ref. {reference}{event.reason ? ` · ${event.reason === 'customer_not_found' ? 'cliente no encontrado' : event.reason === 'missing_customer_mapping' ? 'sin teléfono en el pago' : event.reason}` : ''}</Text></div></Group>
      <Group align="end"><TextInput label={`Teléfono del cliente · ${reference}`} placeholder="55551234" type="tel" maxLength={30} value={phoneFor(event)} onChange={e => {setPhones(current => ({...current, [event.id]: e.currentTarget.value})); setIssue(null);}} disabled={mutation.busy} maw={260}/><Button aria-label={`Asignar pago ${reference}`} onClick={() => assign(event)} loading={mutation.busy}>Asignar</Button></Group>
      {issue?.id === event.id && <Alert color="red" role="alert">{issue.text}</Alert>}
    </Stack>;})}</Stack>}
  </Stack></section>;
}

export default function OwnerAlerts({staff, features, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0);
  const allowed = staff.role === 'OWNER' && features.analytics === true;
  if (!allowed) return <OwnerRestricted title="Alertas y pagos pendientes" owner={staff.role === 'OWNER'}/>;
  const refresh = () => setRevision(value => value + 1);
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Alertas y pagos pendientes</Title><Text c="dimmed" mt="sm" maw={760}>Lo que conviene revisar hoy: señales de riesgo del programa y pagos que llegaron sin cliente. Aquí no se revierten compras; las transacciones marcadas se revisan en Límites y políticas.</Text></div><Button variant="outline" onClick={refresh}>Actualizar</Button></Group>
    <AlertsCenter send={send} revision={revision} onRefresh={refresh}/>
    <PendingPayments send={send} revision={revision} onRefresh={refresh}/>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('jobs')}>Ver trabajos en segundo plano</Button>{features.fraud_monitoring && <Button variant="subtle" onClick={() => onNavigate('limits')}>Transacciones marcadas</Button>}</Group>}
  </Stack>;
}
