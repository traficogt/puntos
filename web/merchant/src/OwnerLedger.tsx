import {useState} from 'react';
import {Alert, Badge, Button, Group, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title} from '@mantine/core';
import {apiUrl} from '/lib.js';
import {BusinessLink, money} from './ui.jsx';
import {merchantRegion} from './region.js';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';
import {anomaliesRelevant, certificationQuery, certificationStatusLabel, correctionIssue, correctionStatus, defaultCertificationPeriod, periodIssue, reasonIssue, shortId, whole} from './owner-operations-model';
import type {AnomaliesResponse, CertificationArchiveResponse, CertificationResponse, LedgerCorrection, ReconciliationResponse} from './owner-operations-model';

// The points ledger controls of the vanilla analytics tab (analytics plan feature): value anomalies
// (GET /api/admin/analytics/anomalies), nightly reconciliation (GET …/ledger-reconciliation), manual
// corrections with the two-owner rule (GET/POST …/ledger-corrections, POST …/:id/apply|reject) and the period
// certification with CSV and archive (GET …/ledger-certification(.csv)?from&to, GET …/ledger-certification/archive).
export const APPLY_CONFIRMATION = '¿Aplicar esta corrección? Se registrará un ajuste para que el saldo del cliente coincida con su historial. El historial original se conserva y la acción queda en auditoría.';
export const REJECT_CONFIRMATION = '¿Rechazar esta corrección? El saldo del cliente no cambia y la solicitud queda cerrada con tu razón.';
const count = (value: unknown) => whole(value as number).toLocaleString('es-GT');
const change = (stored: unknown, expected: unknown) => `${count(stored)} → ${count(expected)}`;

function Anomalies({send, revision, onRefresh}: {send: OwnerRequest; revision: number; onRefresh: () => void}) {
  const resource = useOwnerResource<AnomaliesResponse>('/api/admin/analytics/anomalies', revision, send);
  const data = resource.data;
  const tiles: [string, string][] = data ? [['Saldos negativos', count(data.summary.negative_balance_count)], ['Reversas (24 h)', count(data.summary.reversals_24h)], ['Repeticiones evitadas (24 h)', count(data.summary.replay_events_24h)], ['Correcciones pendientes', count(data.summary.pending_corrections_count)], ['Descuadres en la última conciliación', count(data.summary.latest_reconciliation_mismatches)]] : [];
  return <section aria-labelledby="owner-ledger-anomalies"><Stack gap="md">
    <div><Title order={2} id="owner-ledger-anomalies">Señales de riesgo</Title><Text size="sm" c="dimmed">Saldos que no deberían existir, reversas y mensajes repetidos que PuntosFieles descartó en las últimas 24 horas.</Text></div>
    {resource.loading ? <OwnerLoading label="Consultando señales…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : data && <>
      <SimpleGrid cols={{base: 2, sm: 3, lg: 5}} spacing="md" role="list" aria-label="Señales de riesgo del libro de puntos">{tiles.map(([label, value]) => <div key={label} role="listitem" className="metric"><Text className="metric-value" fw={650}>{value}</Text><Text size="sm" c="dimmed">{label}</Text></div>)}</SimpleGrid>
      {!anomaliesRelevant(data) ? <Text>Sin anomalías relevantes en este momento.</Text> : <SimpleGrid cols={{base: 1, md: 3}} spacing="lg">
        <div><Text fw={600}>Repeticiones (24 h)</Text>{!data.replay_breakdown?.length ? <Text size="sm" c="dimmed">Ninguna.</Text> : data.replay_breakdown.map(row => <Text key={row.action} size="sm">{row.action}: {count(row.count)}</Text>)}</div>
        <div><Text fw={600}>Quién reversó más (24 h)</Text>{!data.top_refund_actors?.length ? <Text size="sm" c="dimmed">Sin reversas.</Text> : data.top_refund_actors.map((row, index) => <Text key={`${row.actor_id ?? row.actor_name ?? index}`} size="sm">{row.actor_name || 'Sin nombre'}: {count(row.reversal_count)}</Text>)}</div>
        <div><Text fw={600}>Clientes con saldo negativo</Text>{!data.negative_balances?.length ? <Text size="sm" c="dimmed">Ninguno.</Text> : data.negative_balances.slice(0, 5).map(row => <Text key={row.id} size="sm">{row.name || row.phone || shortId(row.id)}: {count(row.points)} puntos</Text>)}</div>
      </SimpleGrid>}
    </>}
  </Stack></section>;
}

function Reconciliation({send, revision, onRefresh, onRequestCorrection}: {send: OwnerRequest; revision: number; onRefresh: () => void; onRequestCorrection: (customerId: string) => void}) {
  const resource = useOwnerResource<ReconciliationResponse>('/api/admin/analytics/ledger-reconciliation', revision, send);
  const data = resource.data, latest = data?.latest_run ?? null, runs = data?.recent_runs ?? [], findings = data?.latest_findings ?? [];
  return <section aria-labelledby="owner-ledger-reconciliation"><Stack gap="md">
    <div><Title order={2} id="owner-ledger-reconciliation">Conciliación de saldos</Title><Text size="sm" c="dimmed">Cada noche PuntosFieles recalcula el saldo de cada cliente a partir de su historial y repara las diferencias que puede explicar. Las demás quedan aquí para que las revises.</Text></div>
    {resource.loading ? <OwnerLoading label="Consultando conciliaciones…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : !latest ? <Text>Aún no hay conciliaciones completadas.</Text> : <>
      <Stack gap={4} className="panel" p="md" maw={720}>
        <Text fw={600}>Última corrida: {latest.completed_at ? ownerDateTime(latest.completed_at) : 'en progreso'}</Text>
        <Text size="sm">Clientes revisados: {count(latest.checked_customers)} · Descuadres detectados: {count(latest.mismatched_customers)} · Reparados automáticamente: {count(latest.repaired_customers)}</Text>
      </Stack>
      {runs.length > 1 && <Table.ScrollContainer minWidth={560} type="native" tabIndex={0} role="region" aria-label="Conciliaciones recientes"><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th scope="col">Completada</Table.Th><Table.Th scope="col" ta="right">Revisados</Table.Th><Table.Th scope="col" ta="right">Descuadres</Table.Th><Table.Th scope="col" ta="right">Reparados</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{runs.slice(0, 5).map(run => <Table.Tr key={run.id}><Table.Td>{run.completed_at ? ownerDateTime(run.completed_at) : 'en progreso'}</Table.Td><Table.Td ta="right">{count(run.checked_customers)}</Table.Td><Table.Td ta="right">{count(run.mismatched_customers)}</Table.Td><Table.Td ta="right">{count(run.repaired_customers)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
      {!findings.length ? <Text>Sin descuadres en la última corrida.</Text> : <Table.ScrollContainer minWidth={820} type="native" tabIndex={0} role="region" aria-label="Descuadres de la última conciliación"><Table verticalSpacing="sm"><Table.Caption>Guardado → esperado según el historial. Los reparados ya coinciden.</Table.Caption><Table.Thead><Table.Tr><Table.Th scope="col">Cliente</Table.Th><Table.Th scope="col">Puntos</Table.Th><Table.Th scope="col">Pendientes</Table.Th><Table.Th scope="col">Históricos</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{findings.slice(0, 10).map(finding => <Table.Tr key={finding.customer_id}><Table.Td><Text size="sm" ff="monospace">{shortId(finding.customer_id)}</Text></Table.Td><Table.Td>{change(finding.stored_points, finding.expected_points)}</Table.Td><Table.Td>{change(finding.stored_pending_points, finding.expected_pending_points)}</Table.Td><Table.Td>{change(finding.stored_lifetime_points, finding.expected_lifetime_points)}</Table.Td><Table.Td><Badge variant="light" c="var(--mantine-color-text)" color={finding.repaired ? 'green' : 'orange'}>{finding.repaired ? 'Reparado' : 'Pendiente de revisar'}</Badge></Table.Td><Table.Td>{!finding.repaired && <Button variant="default" size="compact-sm" aria-label={`Solicitar corrección para el cliente ${shortId(finding.customer_id)}`} onClick={() => onRequestCorrection(finding.customer_id)}>Solicitar corrección</Button>}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </>}
  </Stack></section>;
}

function Corrections({send, revision, onRefresh, customerId, onCustomerId, onDirty}: {send: OwnerRequest; revision: number; onRefresh: () => void; customerId: string; onCustomerId: (value: string) => void; onDirty?: OwnerPageProps['onDirty']}) {
  const resource = useOwnerResource<{corrections: LedgerCorrection[]}>('/api/admin/analytics/ledger-corrections?limit=50', revision, send);
  const [reason, setReason] = useState(''), [issue, setIssue] = useState<string | null>(null), [message, setMessage] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null), [rejectReason, setRejectReason] = useState(''), [rejectIssue, setRejectIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const rows = resource.data?.corrections ?? [];
  useOwnerDirty(Boolean(customerId.trim() || reason.trim() || rejectReason.trim()) || mutation.busy, onDirty);
  const done = (text: string) => {setMessage(text); setRejecting(null); setRejectReason(''); onRefresh();};
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = correctionIssue(customerId, reason);
    if (problem) {setIssue(problem); return;}
    setIssue(null); setMessage('');
    mutation.run(() => send('/api/admin/analytics/ledger-corrections', {method: 'POST', body: JSON.stringify({customerId: customerId.trim(), reason: reason.trim()})}), () => {onCustomerId(''); setReason(''); done('Corrección solicitada. Otro propietario debe aplicarla o rechazarla.');});
  };
  const apply = (row: LedgerCorrection) => {
    if (!window.confirm(APPLY_CONFIRMATION)) return;
    setMessage('');
    mutation.run(() => send(`/api/admin/analytics/ledger-corrections/${encodeURIComponent(row.id)}/apply`, {method: 'POST', body: '{}'}), () => done('Corrección aplicada.'));
  };
  const reject = (row: LedgerCorrection) => {
    const problem = reasonIssue(rejectReason, 'La razón del rechazo');
    if (problem) {setRejectIssue(problem); return;}
    if (!window.confirm(REJECT_CONFIRMATION)) return;
    setRejectIssue(null); setMessage('');
    mutation.run(() => send(`/api/admin/analytics/ledger-corrections/${encodeURIComponent(row.id)}/reject`, {method: 'POST', body: JSON.stringify({reason: rejectReason.trim()})}), () => done('Corrección rechazada.'));
  };
  return <section aria-labelledby="owner-ledger-corrections"><Stack gap="md">
    <div><Title order={2} id="owner-ledger-corrections">Correcciones manuales</Title><Text size="sm" c="dimmed">Una corrección propone igualar el saldo guardado al historial del cliente. La solicita un propietario y la aplica o rechaza otro; nunca inventa puntos ni cambia compras anteriores.</Text></div>
    <form onSubmit={submit}><Stack gap="md" maw={640}>
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      {message && <Alert color="green" role="status">{message}</Alert>}
      <TextInput label="Identificador del cliente" description="Los 36 caracteres del cliente, como aparecen en la conciliación o en sus movimientos." value={customerId} onChange={event => {onCustomerId(event.currentTarget.value); setIssue(null); mutation.clear();}} disabled={mutation.busy} spellCheck={false}/>
      <Textarea label="Razón de la corrección" description="Entre 8 y 500 caracteres. Indica qué revisaste y por qué el saldo debe cambiar." minRows={2} autosize maxLength={500} value={reason} onChange={event => {setReason(event.currentTarget.value); setIssue(null); mutation.clear();}} disabled={mutation.busy}/>
      <Group><Button type="submit" loading={mutation.busy}>Solicitar corrección</Button></Group>
    </Stack></form>
    {resource.loading ? <OwnerLoading label="Consultando correcciones…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : !rows.length ? <Text>Sin correcciones recientes.</Text> : <Stack gap="md">{rows.slice(0, 20).map(row => {const state = correctionStatus(row.status); return <Stack key={row.id} className="panel" p="md" gap="xs">
      <Group justify="space-between" align="start"><div><Text fw={600}>Corrección {shortId(row.id)} · cliente {shortId(row.customer_id)}</Text><Text size="sm" c="dimmed">{row.created_at ? ownerDateTime(row.created_at) : ''}{row.resolved_at ? ` · resuelta ${ownerDateTime(row.resolved_at)}` : ''}</Text></div><Badge variant="light" c="var(--mantine-color-text)" color={state.color}>{state.label}</Badge></Group>
      <Text size="sm">Puntos {change(row.requested_stored_points, row.requested_expected_points)} · Pendientes {change(row.requested_stored_pending_points, row.requested_expected_pending_points)} · Históricos {change(row.requested_stored_lifetime_points, row.requested_expected_lifetime_points)}</Text>
      <Text size="sm">{row.reason}</Text>
      {row.status === 'PENDING' && <Group align="start"><Button size="compact-sm" aria-label={`Aplicar corrección ${shortId(row.id)}`} disabled={mutation.busy} onClick={() => apply(row)}>Aplicar</Button><Button size="compact-sm" variant="default" aria-label={`Rechazar corrección ${shortId(row.id)}`} disabled={mutation.busy} aria-expanded={rejecting === row.id} onClick={() => {setRejecting(current => current === row.id ? null : row.id); setRejectReason(''); setRejectIssue(null);}}>Rechazar</Button></Group>}
      {row.status === 'PENDING' && rejecting === row.id && <Stack gap="sm" maw={560}>
        <Textarea label="Razón del rechazo de la corrección" description="Entre 8 y 500 caracteres." minRows={2} autosize maxLength={500} value={rejectReason} onChange={event => {setRejectReason(event.currentTarget.value); setRejectIssue(null);}} disabled={mutation.busy}/>
        {rejectIssue && <Alert color="red" role="alert">{rejectIssue}</Alert>}
        <Group><Button size="compact-sm" color="red" aria-label={`Confirmar rechazo de la corrección ${shortId(row.id)}`} loading={mutation.busy} onClick={() => reject(row)}>Confirmar rechazo</Button><Button size="compact-sm" variant="subtle" disabled={mutation.busy} onClick={() => {setRejecting(null); setRejectReason(''); setRejectIssue(null);}}>Cancelar</Button></Group>
      </Stack>}
    </Stack>;})}</Stack>}
  </Stack></section>;
}

function Certification({send}: {send: OwnerRequest}) {
  const region = merchantRegion();
  const [period] = useState(() => defaultCertificationPeriod(new Date(), region.timezone));
  const [from, setFrom] = useState(period.from), [to, setTo] = useState(period.to), [applied, setApplied] = useState(period), [issue, setIssue] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const query = certificationQuery(applied.from, applied.to);
  const resource = useOwnerResource<CertificationResponse>(`/api/admin/analytics/ledger-certification${query}`, revision, send);
  const archive = useOwnerResource<CertificationArchiveResponse>('/api/admin/analytics/ledger-certification/archive', revision, send);
  const data = resource.data, status = data ? certificationStatusLabel(data.certification_status) : null, rows = data?.daily_rows ?? [], days = archive.data?.available_days ?? [];
  const refresh = () => setRevision(value => value + 1);
  return <section aria-labelledby="owner-ledger-certification"><Stack gap="md">
    <div><Title order={2} id="owner-ledger-certification">Certificación del periodo</Title><Text size="sm" c="dimmed">Totales diarios de puntos emitidos, canjeados, reversados y vencidos, con los ajustes manuales y las tarjetas de regalo. Sirve como respaldo contable del libro de puntos.</Text></div>
    <form noValidate onSubmit={event => {event.preventDefault(); const problem = periodIssue(from, to); if (problem) {setIssue(problem); return;} setIssue(null); setApplied({from, to});}}><Group align="end">
      <TextInput type="date" label="Desde" value={from} max={to || undefined} onChange={event => {setFrom(event.currentTarget.value); setIssue(null);}}/>
      <TextInput type="date" label="Hasta" value={to} min={from || undefined} onChange={event => {setTo(event.currentTarget.value); setIssue(null);}}/>
      <Button type="submit" variant="outline" loading={resource.loading}>Consultar periodo</Button>
      <Button variant="subtle" onClick={refresh} disabled={resource.loading}>Actualizar</Button>
    </Group></form>
    {issue && <Alert color="red" role="alert">{issue}</Alert>}
    {resource.loading ? <OwnerLoading label="Preparando certificación…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : data && status && <>
      <Stack gap={4} className="panel" p="md" maw={760}>
        <Group justify="space-between" align="start"><Text fw={600}>{data.business?.name || 'Negocio'} · {data.period.from} a {data.period.to}</Text><Badge variant="light" c="var(--mantine-color-text)" color={status.color}>{status.label}</Badge></Group>
        <Text size="sm">Emitidos {count(data.summary.points_issued)} pts · Canjeados {count(data.summary.points_redeemed)} pts · Reversados {count(data.summary.points_reversed)} pts · Vencidos {count(data.summary.points_expired)} pts · Ajustes manuales {count(data.summary.adjustment_points)} pts</Text>
        <Text size="sm">Tarjetas de regalo emitidas {money(Number(data.summary.gift_cards_issued_q || 0))} · usadas {money(Number(data.summary.gift_cards_redeemed_q || 0))}</Text>
        <Text size="sm">Riesgos abiertos: correcciones pendientes {count(data.summary.pending_corrections_count)} · saldos negativos {count(data.summary.negative_balance_count)} · descuadres en la última conciliación {count(data.summary.latest_reconciliation_mismatches)}</Text>
        <Text size="sm">Última conciliación completada: {data.summary.latest_reconciliation_completed_at ? ownerDateTime(data.summary.latest_reconciliation_completed_at) : 'sin registro'}</Text>
        <BusinessLink href={apiUrl(`/api/admin/analytics/ledger-certification.csv${query}`)} target="_blank" rel="noopener">Descargar CSV del periodo</BusinessLink>
      </Stack>
      {!rows.length ? <Text>Sin movimientos diarios para el periodo seleccionado.</Text> : <Table.ScrollContainer minWidth={900} type="native" tabIndex={0} role="region" aria-label="Movimientos diarios del periodo"><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th scope="col">Día</Table.Th><Table.Th scope="col" ta="right">Emitidos</Table.Th><Table.Th scope="col" ta="right">Canjeados</Table.Th><Table.Th scope="col" ta="right">Reversados</Table.Th><Table.Th scope="col" ta="right">Vencidos</Table.Th><Table.Th scope="col" ta="right">Ajustes</Table.Th><Table.Th scope="col" ta="right">GC emitidas</Table.Th><Table.Th scope="col" ta="right">GC usadas</Table.Th><Table.Th scope="col" ta="right">Repeticiones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.slice(0, 31).map(row => <Table.Tr key={row.date}><Table.Td>{row.date}</Table.Td><Table.Td ta="right">{count(row.points_issued)}</Table.Td><Table.Td ta="right">{count(row.points_redeemed)}</Table.Td><Table.Td ta="right">{count(row.points_reversed)}</Table.Td><Table.Td ta="right">{count(row.points_expired)}</Table.Td><Table.Td ta="right">{count(row.adjustment_points)}</Table.Td><Table.Td ta="right">{money(Number(row.gift_cards_issued_q || 0))}</Table.Td><Table.Td ta="right">{money(Number(row.gift_cards_redeemed_q || 0))}</Table.Td><Table.Td ta="right">{count(row.replay_events)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </>}
    <Stack gap="xs">
      <Title order={3}>Certificaciones archivadas</Title>
      {archive.loading ? <OwnerLoading label="Consultando archivo…"/> : archive.error ? <OwnerError error={archive.error} retry={refresh}/> : <>
        <Text size="sm" c="dimmed">Días disponibles: {days.length} · Retención: {count(archive.data?.retention_days)} días</Text>
        {!days.length ? <Text>Sin certificaciones históricas disponibles.</Text> : <Stack gap={6}>{days.slice(0, 12).map(day => {const state = certificationStatusLabel(day.certification_status || ''); return <Group key={day.date} justify="space-between" align="center" wrap="wrap"><Text size="sm">{day.date} · {day.period?.from || '—'} a {day.period?.to || '—'} · <Badge variant="light" c="var(--mantine-color-text)" color={state.color} size="sm">{state.label}</Badge></Text><Group gap="md"><BusinessLink href={apiUrl(day.json_url)} target="_blank" rel="noopener" aria-label={`Descargar JSON del ${day.date}`}>JSON</BusinessLink><BusinessLink href={apiUrl(day.csv_url)} target="_blank" rel="noopener" aria-label={`Descargar CSV del ${day.date}`}>CSV</BusinessLink></Group></Group>;})}</Stack>}
      </>}
    </Stack>
  </Stack></section>;
}

export default function OwnerLedger({staff, features, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [customerId, setCustomerId] = useState('');
  const allowed = staff.role === 'OWNER' && features.analytics === true;
  if (!allowed) return <OwnerRestricted title="Conciliación del libro de puntos" owner={staff.role === 'OWNER'}/>;
  const refresh = () => setRevision(value => value + 1);
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Conciliación del libro de puntos</Title><Text c="dimmed" mt="sm" maw={760}>Comprueba que cada saldo coincide con su historial, corrige con evidencia y certifica un periodo. Nada de lo que ves aquí modifica compras ya registradas.</Text></div><Button variant="outline" onClick={refresh}>Actualizar</Button></Group>
    <Anomalies send={send} revision={revision} onRefresh={refresh}/>
    <Reconciliation send={send} revision={revision} onRefresh={refresh} onRequestCorrection={id => {setCustomerId(id); document.getElementById('owner-ledger-corrections')?.scrollIntoView({block: 'start'});}}/>
    <Corrections send={send} revision={revision} onRefresh={refresh} customerId={customerId} onCustomerId={setCustomerId} onDirty={onDirty}/>
    <Certification send={send}/>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('audit')}>Ver auditoría</Button><Button variant="subtle" onClick={() => onNavigate('jobs')}>Trabajos en segundo plano</Button></Group>}
  </Stack>;
}
