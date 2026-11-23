import {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Anchor, Badge, Button, Group, Paper, Progress, Stack, Text, Textarea, Title} from '@mantine/core';
import {createMerchantApi} from './api-contracts';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, OwnerLoading, OwnerError, OwnerRestricted} from './owner-workspace';
import type {OwnerFailure, OwnerPageProps, OwnerRequest} from './owner-workspace';
import type {OwnerProgressResponse} from './types/api';
import {availableGoals, goalProgressPct, goalProgressText, latestMilestone, launchPct, launchStepsText, milestoneReached, momentumText, newMilestoneLabels, nextLaunchStep, pendingMilestones, progressDate, reachedMilestones, showsFullProgress} from './owner-progress-model';

// "Tu progreso" (docs/product/2026-11-23-owner-progress.md, v2). Every count comes from the server; the UI
// shows "N de 5 pasos" and the goal's own progress, never a composite score. GET 404 = mode off: nothing is
// rendered. The launch path comes first; goal, milestone history, review and momentum appear once it is
// complete and the business is in the full treatment (checklist mode and holdouts see the launch path only).
export const OWNER_PROGRESS_PATH = '/api/admin/owner-progress';
const GOAL_PATH = '/api/admin/owner-progress/goal';
const ACKNOWLEDGE_PATH = '/api/admin/owner-progress/acknowledge';
const REVIEW_PATH = '/api/admin/owner-progress/review';
const VISIBILITY_PATH = '/api/admin/owner-progress/visibility';
type Client = ReturnType<typeof createMerchantApi>;
/** A 404 means the feature is off for this business; it is not an error to show. */
export const progressUnavailable = (error: OwnerFailure | null) => error?.status === 404;
const rowBorder = {borderBottom: '1px solid var(--mantine-color-default-border)'};

function GoalPicker({id, data, client, onChanged, onCancel}: {id: string; data: OwnerProgressResponse; client: Client; onChanged: () => void; onCancel: () => void}) {
  const options = availableGoals(data);
  const mutation = useOwnerMutation();
  return <Stack gap="xs" role="group" aria-labelledby={id}>
    <Text id={id} fw={600} size="sm">Elige otra meta</Text>
    {mutation.error && <OwnerError error={mutation.error}/>}
    {options.length ? <Group gap="xs">{options.map(option => <Button key={option.key} variant="default" size="compact-sm" disabled={mutation.busy} onClick={() => mutation.run(() => client.post(GOAL_PATH, {key: option.key}), onChanged)}>{option.label}</Button>)}</Group> : <Text size="sm">No hay otras metas disponibles por ahora.</Text>}
    <Button variant="subtle" size="compact-sm" w="fit-content" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button>
  </Stack>;
}

/** Overview card: launch progress or the current goal, the latest milestone, the next step and three options. */
export function OwnerProgressCard({onNavigate, request: send = request}: {onNavigate: (page: string) => void; request?: OwnerRequest}) {
  const [revision, setRevision] = useState(0), [picker, setPicker] = useState(false), [seen, setSeen] = useState<string[]>([]);
  const resource = useOwnerResource<OwnerProgressResponse>(OWNER_PROGRESS_PATH, revision, send);
  const actions = useOwnerMutation();
  const client = useMemo(() => createMerchantApi(send), [send]);
  const heading = useRef<HTMLHeadingElement>(null);
  const data = resource.data;
  // Loading, any error (a 404 is mode off) and the persisted hidden state all render nothing.
  if (!data || data.hidden) return null;
  const refresh = () => setRevision(value => value + 1);
  const full = showsFullProgress(data), goal = full ? data.goal : null;
  const fresh = data.new_milestones.filter(key => !seen.includes(key));
  const latest = full ? latestMilestone(data.milestones) : null;
  const next = data.launch.complete ? null : nextLaunchStep(data.launch);
  const progressText = goal ? goalProgressText(goal) : null, pct = goal ? goalProgressPct(goal) : null;
  function acknowledge() {
    const keys = fresh;
    setSeen(current => [...current, ...keys]);
    heading.current?.focus();
    actions.run(() => client.post(ACKNOWLEDGE_PATH, {keys}), () => {});
  }
  return <section aria-labelledby="owner-progress-card"><Paper withBorder radius="md" p="md"><Stack gap="sm">
    {fresh.length > 0 && <Alert color="green" title={fresh.length === 1 ? 'Nuevo hito alcanzado' : 'Nuevos hitos alcanzados'} withCloseButton closeButtonLabel="Cerrar aviso" onClose={acknowledge}>{newMilestoneLabels(data, fresh).join(' · ')}</Alert>}
    <Title order={2} id="owner-progress-card" ref={heading} tabIndex={-1}>Tu progreso</Title>
    {actions.error && <OwnerError error={actions.error}/>}
    {!data.launch.complete ? <><Text fw={600}>Puesta en marcha: {launchStepsText(data.launch)}</Text><Progress value={launchPct(data.launch)} aria-label="Pasos de la puesta en marcha completados"/></> : goal ? <><Text fw={600}>Meta: {goal.label}</Text>{progressText && <Text size="sm">{progressText}</Text>}{pct != null && <Progress value={pct} aria-label={`Avance de la meta: ${progressText ?? goal.label}`}/>}</> : <Text fw={600}>Programa en marcha · {launchStepsText(data.launch)}</Text>}
    {latest && <Text size="sm" c="dimmed">Último hito: {latest.label}{progressDate(latest.reached_at) ? ` · ${progressDate(latest.reached_at)}` : ''}</Text>}
    {next ? <Text size="sm">Siguiente paso: <Anchor href={next.href}>{next.label}</Anchor></Text> : goal && <Text size="sm">Siguiente paso: <Anchor href={goal.href}>{goal.label}</Anchor></Text>}
    <Group gap="xs"><Button variant="default" size="compact-sm" onClick={() => onNavigate('progress')}>Ver avance</Button>{goal && <Button variant="subtle" size="compact-sm" aria-expanded={picker} disabled={actions.busy} onClick={() => setPicker(value => !value)}>Cambiar meta</Button>}<Button variant="subtle" size="compact-sm" color="gray" disabled={actions.busy} onClick={() => actions.run(() => client.post(VISIBILITY_PATH, {hidden: true}), refresh)}>Ocultar</Button></Group>
    {picker && <GoalPicker id="owner-progress-card-picker" data={data} client={client} onChanged={() => {setPicker(false); refresh();}} onCancel={() => setPicker(false)}/>}
  </Stack></Paper></section>;
}

export default function OwnerProgress({staff, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [picker, setPicker] = useState(false), [note, setNote] = useState(''), [reviewed, setReviewed] = useState<'keep' | 'adjust' | null>(null), [message, setMessage] = useState('');
  const allowed = staff.role === 'OWNER';
  const resource = useOwnerResource<OwnerProgressResponse>(allowed ? OWNER_PROGRESS_PATH : null, revision, send);
  const actions = useOwnerMutation();
  const client = useMemo(() => createMerchantApi(send), [send]);
  const showAgain = useRef<HTMLButtonElement>(null), focusShowAgain = useRef(false), milestonesHeading = useRef<HTMLHeadingElement>(null);
  useOwnerDirty(note.trim().length > 0, onDirty);
  useEffect(() => {if (focusShowAgain.current && resource.data?.hidden) {focusShowAgain.current = false; showAgain.current?.focus();}}, [resource.data]);
  if (!allowed) return <OwnerRestricted title="Tu progreso" owner={false}/>;
  const data = resource.data, goal = data?.goal ?? null;
  const refresh = () => setRevision(value => value + 1);
  const full = data ? showsFullProgress(data) : false;
  const progressText = goal ? goalProgressText(goal) : null, pct = goal ? goalProgressPct(goal) : null;
  const reached = data ? reachedMilestones(data.milestones) : [], pending = data ? pendingMilestones(data.milestones) : [];
  const firstReview = data ? !milestoneReached(data.milestones, 'primera_revision') : true;
  function review(decision: 'keep' | 'adjust') {
    const trimmed = note.trim();
    actions.run(() => client.post(REVIEW_PATH, trimmed ? {decision, note: trimmed} : {decision}), () => {setReviewed(decision); setNote(''); refresh();});
  }
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Tu progreso</Title><Text c="dimmed" mt="sm" maw={740}>Lo que ya pusiste en marcha, los hitos que alcanzó tu programa y un siguiente paso sugerido. Se cuenta solo la actividad real registrada en PuntosFieles: sin ensayos, sin cuentas de prueba y sin historial importado.</Text></div><Button variant="outline" onClick={refresh} loading={resource.loading}>Actualizar</Button></Group>
    {message && <Alert color="green" role="status">{message}</Alert>}
    {actions.error && <OwnerError error={actions.error}/>}
    {resource.loading ? <OwnerLoading label="Cargando tu progreso…"/> : resource.error ? (progressUnavailable(resource.error) ? <Text>Tu progreso no está disponible para este negocio por el momento.</Text> : <OwnerError error={resource.error} retry={refresh}/>) : data && (data.hidden ? <Group gap="xs" align="center"><Text>Tu progreso está oculto en Inicio y en esta sección.</Text><Button ref={showAgain} variant="default" size="compact-sm" loading={actions.busy} onClick={() => actions.run(() => client.post(VISIBILITY_PATH, {hidden: false}), () => {setMessage('Tu progreso vuelve a mostrarse.'); refresh();})}>Mostrar de nuevo</Button></Group> : <>
      <section aria-labelledby="owner-progress-launch"><Stack gap="md">
        <Title order={2} id="owner-progress-launch">Puesta en marcha</Title>
        <Text fw={600}>{launchStepsText(data.launch)}{data.launch.complete ? ' · Programa en marcha' : ''}</Text>
        <Progress value={launchPct(data.launch)} aria-label="Pasos de la puesta en marcha completados"/>
        <Stack component="ol" gap={0} pl={0} m={0} style={{listStyle: 'none'}} aria-label="Pasos de la puesta en marcha">{data.launch.steps.map((step, index) => <Group component="li" key={step.key} justify="space-between" align="center" py="sm" wrap="wrap" style={rowBorder}><Group gap="sm" style={{flex: '1 1 320px'}}><Badge variant="default" miw={92} leftSection={step.done ? <span aria-hidden="true">✓</span> : undefined}>{step.done ? 'Listo' : 'Pendiente'}</Badge><div><Text fw={600}>{index + 1}. {step.label}</Text>{step.done && progressDate(step.done_at) && <Text size="sm" c="dimmed">Completado el {progressDate(step.done_at)}</Text>}</div></Group>{!step.done && <Anchor href={step.href} size="sm">Ir a este paso</Anchor>}</Group>)}</Stack>
        {!data.launch.complete && <Text size="xs" c="dimmed">La identidad visual es una meta sugerida, no un paso obligatorio.</Text>}
      </Stack></section>
      {full && data.launch.complete && <>
        <section aria-labelledby="owner-progress-goal"><Stack gap="sm" maw={640}>
          <Title order={2} id="owner-progress-goal">Meta sugerida</Title>
          {goal ? <>
            <Text fw={600}>{goal.label}</Text>
            {progressText && <Text size="sm">{progressText}</Text>}
            {pct != null && <Progress value={pct} aria-label={`Avance de la meta: ${progressText ?? goal.label}`}/>}
            <Anchor href={goal.href} size="sm">Ir al siguiente paso</Anchor>
            <Group gap="xs"><Button variant="default" size="compact-sm" aria-expanded={picker} disabled={actions.busy} onClick={() => setPicker(value => !value)}>Cambiar meta</Button><Button variant="subtle" size="compact-sm" color="gray" disabled={actions.busy} onClick={() => actions.run(() => client.post(GOAL_PATH, {dismiss: goal.key}), () => {setPicker(false); setMessage('Sugerencia oculta.'); refresh();})}>Ocultar sugerencia</Button></Group>
          </> : <>
            <Text>Sin meta sugerida por ahora.</Text>
            <Button variant="default" size="compact-sm" w="fit-content" aria-expanded={picker} onClick={() => setPicker(value => !value)}>Elegir una meta</Button>
          </>}
          {picker && <GoalPicker id="owner-progress-goal-picker" data={data} client={client} onChanged={() => {setPicker(false); setMessage('Meta actualizada.'); refresh();}} onCancel={() => setPicker(false)}/>}
          <Text size="xs" c="dimmed">Una sugerencia oculta no vuelve a aparecer durante 30 días.</Text>
        </Stack></section>
        <section aria-labelledby="owner-progress-milestones"><Stack gap="sm">
          <Title order={2} id="owner-progress-milestones" ref={milestonesHeading} tabIndex={-1}>Hitos alcanzados</Title>
          {!reached.length ? <Text>Todavía no hay hitos alcanzados.</Text> : <Stack gap={4}>{reached.map(milestone => <Group key={milestone.key} gap="xs" wrap="wrap"><Text size="sm">{milestone.label}{progressDate(milestone.reached_at) ? ` · ${progressDate(milestone.reached_at)}` : ''}</Text>{data.new_milestones.includes(milestone.key) && <Badge variant="default" size="sm">Nuevo</Badge>}</Group>)}</Stack>}
          {data.new_milestones.length > 0 && <Button variant="default" size="compact-sm" w="fit-content" disabled={actions.busy} onClick={() => actions.run(() => client.post(ACKNOWLEDGE_PATH, {keys: data.new_milestones}), () => {milestonesHeading.current?.focus(); refresh();})}>Marcar como vistos</Button>}
          {pending.length > 0 && <Text size="xs" c="dimmed">Por alcanzar: {pending.map(milestone => milestone.label).join(' · ')}.</Text>}
        </Stack></section>
        <section aria-labelledby="owner-progress-review"><Stack gap="sm" maw={640}>
          <Title order={2} id="owner-progress-review">{firstReview ? 'Primera revisión del programa' : 'Revisión del programa'}</Title>
          <Text size="sm">Mira tus números en Reportes y decide si mantienes la regla y la recompensa como están o las ajustas. Registrar la decisión aquí cuenta como revisión; consultar el reporte no.</Text>
          {reviewed ? <><Alert color="green" role="status">Revisión registrada: {reviewed === 'keep' ? 'mantener el programa como está' : 'ajustar el programa'}.</Alert>{reviewed === 'adjust' && onNavigate && <Button variant="default" w="fit-content" onClick={() => onNavigate('launch')}>Ir a Preparar mi programa</Button>}</> : <>
            <Textarea label="Nota (opcional)" description="Qué viste y por qué decides así." maxLength={500} autosize minRows={2} value={note} onChange={event => setNote(event.currentTarget.value)} disabled={actions.busy}/>
            <Group gap="xs"><Button disabled={actions.busy} onClick={() => review('keep')}>Mantener</Button><Button variant="default" disabled={actions.busy} onClick={() => review('adjust')}>Ajustar</Button>{onNavigate && <Button variant="subtle" disabled={actions.busy} onClick={() => onNavigate('reports')}>Ver Reportes</Button>}</Group>
          </>}
        </Stack></section>
        <Text size="sm" c="dimmed">{momentumText(data.momentum)}. Una semana sin nada pendiente también cuenta; la pausa cubre una semana sin actividad.</Text>
      </>}
      <Text size="xs" c="dimmed">«Clientes que vuelven» son clientes con una visita posterior registrada en otro día. Una compra con dos registros nunca cuenta como regreso.</Text>
      <Group><Button variant="subtle" color="gray" disabled={actions.busy} onClick={() => actions.run(() => client.post(VISIBILITY_PATH, {hidden: true}), () => {focusShowAgain.current = true; setPicker(false); setMessage(''); refresh();})}>Ocultar Tu progreso</Button></Group>
    </>)}
  </Stack>;
}
