import {useEffect, useRef, useState} from 'react';
import {Alert, Badge, Button, Group, Stack, Table, Text, Title} from '@mantine/core';
import {request, useOwnerResource, useOwnerMutation, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps} from './owner-workspace';
import {jobStatus, jobTypeLabel, pollJob} from './owner-operations-model';
import type {BackgroundJob, CalculateResponse} from './owner-operations-model';

// GET /api/admin/jobs, POST /api/admin/analytics/calculate and GET /api/admin/jobs/:id (analytics plan
// feature). The vanilla analytics tab queued a recalculation and polled the job up to 20 times, 1.5 s apart;
// this screen keeps that loop and asks before queueing, since the job rewrites the business indicators.
export const RECALC_CONFIRMATION = 'Se encolará un recálculo de la analítica del negocio. Puede tardar unos segundos y los indicadores se actualizarán al terminar. ¿Continuar?';
type Outcome = {tone: 'green' | 'yellow'; text: string};

export default function OwnerJobs({staff, features, onNavigate, request: send = request, pollDelayMs = 1500}: OwnerPageProps & {pollDelayMs?: number}) {
  const [revision, setRevision] = useState(0), [progress, setProgress] = useState(''), [outcome, setOutcome] = useState<Outcome | null>(null);
  const mutation = useOwnerMutation();
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const allowed = staff.role === 'OWNER' && features.analytics === true;
  const resource = useOwnerResource<{jobs: BackgroundJob[]}>(allowed ? '/api/admin/jobs?limit=12' : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Trabajos en segundo plano" owner={staff.role === 'OWNER'}/>;
  const jobs = resource.data?.jobs ?? [];
  const refresh = () => setRevision(value => value + 1);
  const recalculate = () => {
    if (!window.confirm(RECALC_CONFIRMATION)) return;
    setOutcome(null); setProgress('Encolando el recálculo…');
    mutation.run(async () => {
      const queued = await send<CalculateResponse>('/api/admin/analytics/calculate', {method: 'POST', body: '{}'});
      const jobId = queued.job?.id;
      if (!jobId) return {state: 'queued' as const};
      if (alive.current) setProgress('Recálculo en cola. Esperando al trabajo…');
      return pollJob(id => send<{job?: BackgroundJob | null}>(`/api/admin/jobs/${encodeURIComponent(id)}`), jobId, {delayMs: pollDelayMs, onProgress: (attempt, status) => {if (alive.current) setProgress(`Recálculo ${status === 'RUNNING' ? 'en proceso' : 'en cola'} (consulta ${attempt} de 20)…`);}});
    }, result => {
      setProgress('');
      if (result.state === 'done') setOutcome({tone: 'green', text: 'Analítica recalculada. Los indicadores ya reflejan los datos actuales.'});
      else if (result.state === 'failed') setOutcome({tone: 'yellow', text: `El recálculo falló: ${result.error}`});
      else setOutcome({tone: 'yellow', text: 'El recálculo sigue en proceso. Actualiza esta lista en unos segundos.'});
      refresh();
    });
  };
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Trabajos en segundo plano</Title><Text c="dimmed" mt="sm" maw={760}>Cálculos de analítica, conciliaciones, importaciones de caja y envíos que PuntosFieles ejecuta por su cuenta. Un trabajo fallido no borra datos: se reintenta o se vuelve a encolar.</Text></div><Group><Button variant="outline" onClick={refresh} loading={resource.loading} disabled={mutation.busy}>Actualizar</Button><Button onClick={recalculate} loading={mutation.busy} disabled={resource.loading}>Recalcular analítica</Button></Group></Group>
    {mutation.busy && progress && <Text role="status">{progress}</Text>}
    {mutation.error && <OwnerError error={mutation.error}/>}
    {outcome && !mutation.busy && <Alert color={outcome.tone} role="status">{outcome.text}</Alert>}
    {resource.loading ? <OwnerLoading label="Consultando trabajos…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !jobs.length ? <Text>No hay trabajos recientes.</Text> : <Table.ScrollContainer minWidth={760} type="native" tabIndex={0} role="region" aria-label="Trabajos recientes en segundo plano"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Creado</Table.Th><Table.Th scope="col">Trabajo</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col" ta="right">Intentos</Table.Th><Table.Th scope="col">Detalle</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{jobs.map(job => {const state = jobStatus(job.status); return <Table.Tr key={job.id}><Table.Td>{ownerDateTime(job.created_at)}</Table.Td><Table.Td><Text fw={600}>{jobTypeLabel(job.job_type)}</Text>{jobTypeLabel(job.job_type) !== job.job_type && <Text size="xs" c="dimmed">{job.job_type}</Text>}</Table.Td><Table.Td><Badge variant="light" c="var(--mantine-color-text)" color={state.color}>{state.label}</Badge></Table.Td><Table.Td ta="right">{Number(job.attempts ?? 0)}</Table.Td><Table.Td>{job.error ? <Text size="sm" c="red">{job.error}</Text> : job.completed_at ? <Text size="sm" c="dimmed">Terminó {ownerDateTime(job.completed_at)}</Text> : <Text size="sm" c="dimmed">Sin detalle</Text>}</Table.Td></Table.Tr>;})}</Table.Tbody></Table></Table.ScrollContainer>}
    <Text size="xs" c="dimmed">Se muestran los últimos 12 trabajos del negocio. Los trabajos fallidos también aparecen en Alertas y pagos pendientes.</Text>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('alerts')}>Ver alertas</Button><Button variant="subtle" onClick={() => onNavigate('operations')}>Estado de la operación</Button></Group>}
  </Stack>;
}
