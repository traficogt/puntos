import {useState} from 'react';
import {Alert, Badge, Button, Group, NativeSelect, Stack, Table, Text, Textarea, TextInput, Title} from '@mantine/core';
import {NumberInput} from './inputs';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, mayDiscard, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';

// Shapes follow gamification-support.js (AchievementCreateSchema / ChallengeCreateSchema) and the
// achievements / challenges tables. Numeric columns can arrive as strings from the database driver.
export interface Achievement {id: string; name: string; description?: string | null; icon_url?: string | null; requirement_type: string; requirement_value: number | string | null; points_reward: number | string | null; active: boolean}
export interface Challenge {id: string; name: string; description?: string | null; challenge_type: string; requirement_type: string; requirement_value: number | string; reward_points: number | string; start_date: string; end_date?: string | null; recurrence?: string | null; active: boolean}
export const requirementTypes = [
  {value: 'visits', label: 'Visitas'},
  {value: 'spend', label: 'Gasto total (moneda del negocio)'},
  {value: 'points', label: 'Puntos acumulados'},
  {value: 'items', label: 'Artículos comprados'},
  {value: 'referrals', label: 'Referidos'},
  {value: 'streak', label: 'Racha de días'},
];
const challengeTypes = [{value: 'limited_time', label: 'Tiempo limitado'}, {value: 'recurring', label: 'Recurrente'}, {value: 'milestone', label: 'Meta acumulada'}];
const recurrences = [{value: '', label: 'No recurrente'}, {value: 'daily', label: 'Diario'}, {value: 'weekly', label: 'Semanal'}, {value: 'monthly', label: 'Mensual'}];
const label = (options: {value: string; label: string}[], value: string) => options.find(option => option.value === value)?.label ?? value;
const integer = (value: number | string, minimum: number) => Number.isInteger(Number(value)) && Number(value) >= minimum && Number(value) <= 1000000;
/** datetime-local value for the device's current minute. */
export function localNow(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function toIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

interface AchievementForm {name: string; description: string; icon_url: string; requirement_type: string; requirement_value: number | string; points_reward: number | string}
const emptyAchievement: AchievementForm = {name: '', description: '', icon_url: '', requirement_type: 'visits', requirement_value: '', points_reward: 50};
export function achievementIssue(form: AchievementForm): string | null {
  if (!form.name.trim() || form.name.trim().length > 100) return 'Escribe un nombre de hasta 100 caracteres.';
  if (form.description.trim().length > 500) return 'La descripción admite hasta 500 caracteres.';
  if (form.icon_url.trim().length > 300) return 'El icono admite hasta 300 caracteres.';
  if (!integer(form.requirement_value, 1)) return 'El valor requerido es un número entero de 1 o más.';
  if (!integer(form.points_reward, 0)) return 'Los puntos de recompensa son un número entero de 0 o más.';
  return null;
}
export function achievementPayload(form: AchievementForm) {
  return {name: form.name.trim(), ...(form.description.trim() ? {description: form.description.trim()} : {}), icon_url: form.icon_url.trim() || '🏆', requirement_type: form.requirement_type, requirement_value: Number(form.requirement_value), points_reward: Number(form.points_reward), active: true};
}
function AchievementEditor({send, onDone, onCancel, onDirty}: {send: OwnerRequest; onDone: () => void; onCancel: () => void; onDirty?: OwnerPageProps['onDirty']}) {
  const [form, setForm] = useState(emptyAchievement), [issue, setIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyAchievement);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof AchievementForm>(key: K, value: AchievementForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  return <section aria-labelledby="owner-achievement-editor"><form onSubmit={event => {event.preventDefault(); const problem = achievementIssue(form); if (problem) {setIssue(problem); return;} mutation.run(() => send('/api/admin/achievements', {method: 'POST', body: JSON.stringify(achievementPayload(form))}), onDone);}}>
    <Stack gap="md" maw={680}>
      <Title order={3} id="owner-achievement-editor">Nuevo logro</Title>
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      <TextInput label="Nombre" placeholder="Ej: Comprador frecuente" required maxLength={100} value={form.name} onChange={event => change('name', event.currentTarget.value)} disabled={mutation.busy}/>
      <Textarea label="Descripción (opcional)" placeholder="Realiza 20 compras" maxLength={500} minRows={2} autosize value={form.description} onChange={event => change('description', event.currentTarget.value)} disabled={mutation.busy}/>
      <TextInput label="Icono (emoji, opcional)" placeholder="🏆" maxLength={300} value={form.icon_url} onChange={event => change('icon_url', event.currentTarget.value)} disabled={mutation.busy}/>
      <NativeSelect label="Tipo de requisito" data={requirementTypes} value={form.requirement_type} onChange={event => change('requirement_type', event.currentTarget.value)} disabled={mutation.busy}/>
      <NumberInput label="Valor requerido" placeholder="20" min={1} max={1000000} allowDecimal={false} value={form.requirement_value} onChange={value => change('requirement_value', value)} disabled={mutation.busy}/>
      <NumberInput label="Puntos de recompensa" description="0 otorga el logro sin puntos adicionales." min={0} max={1000000} allowDecimal={false} value={form.points_reward} onChange={value => change('points_reward', value)} disabled={mutation.busy}/>
      <Group><Button type="submit" loading={mutation.busy} disabled={!dirty}>Crear logro</Button><Button variant="default" disabled={mutation.busy} onClick={() => {if (mayDiscard(dirty)) onCancel();}}>Cancelar</Button></Group>
    </Stack>
  </form></section>;
}
function Achievements({send, onDirty}: {send: OwnerRequest; onDirty?: OwnerPageProps['onDirty']}) {
  const [revision, setRevision] = useState(0), [adding, setAdding] = useState(false), [message, setMessage] = useState('');
  const resource = useOwnerResource<{achievements: Achievement[]}>('/api/admin/achievements', revision, send);
  const actions = useOwnerMutation();
  const refresh = () => setRevision(value => value + 1);
  const rows = resource.data?.achievements ?? [];
  return <section aria-labelledby="owner-achievements"><Stack gap="md">
    <Group justify="space-between"><div><Title order={2} id="owner-achievements">Logros</Title><Text c="dimmed" size="sm">Se otorgan automáticamente cuando el cliente cumple el requisito.</Text></div><Button onClick={() => {setAdding(true); setMessage('');}} disabled={adding || resource.loading || !!resource.error}>Agregar logro</Button></Group>
    {message && <Alert color="green" role="status">{message}</Alert>}
    {actions.error && <OwnerError error={actions.error}/>}
    {adding && <AchievementEditor send={send} onDirty={onDirty} onCancel={() => setAdding(false)} onDone={() => {setAdding(false); setMessage('Logro creado.'); refresh();}}/>}
    {resource.loading ? <OwnerLoading label="Cargando logros…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !rows.length ? <Text>Todavía no hay logros configurados.</Text> : <Table.ScrollContainer minWidth={640} type="native" tabIndex={0} role="region" aria-label="Logros del programa"><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th scope="col">Logro</Table.Th><Table.Th scope="col">Requisito</Table.Th><Table.Th scope="col">Recompensa</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={row.id}><Table.Td><Text fw={600}><span aria-hidden="true">{row.icon_url && !/^https?:/i.test(row.icon_url) ? `${row.icon_url} ` : ''}</span>{row.name}</Text>{row.description && <Text size="sm" c="dimmed">{row.description}</Text>}</Table.Td><Table.Td>{label(requirementTypes, row.requirement_type)}: {Number(row.requirement_value ?? 0).toLocaleString('es-GT')}</Table.Td><Table.Td>+{Number(row.points_reward ?? 0).toLocaleString('es-GT')} puntos</Table.Td><Table.Td><Badge variant="light" color={row.active ? 'green' : 'gray'}>{row.active ? 'Activo' : 'Inactivo'}</Badge></Table.Td><Table.Td><Group gap="xs"><Button variant="default" size="compact-sm" disabled={adding || actions.busy} aria-label={`${row.active ? 'Desactivar' : 'Activar'} logro ${row.name}`} onClick={() => {setMessage(''); actions.run(() => send(`/api/admin/achievements/${encodeURIComponent(row.id)}`, {method: 'PUT', body: JSON.stringify({active: !row.active})}), () => {setMessage(row.active ? 'Logro desactivado.' : 'Logro activado.'); refresh();});}}>{row.active ? 'Desactivar' : 'Activar'}</Button><Button variant="subtle" color="red" size="compact-sm" disabled={adding || actions.busy} aria-label={`Eliminar logro ${row.name}`} onClick={() => {if (!window.confirm(`¿Eliminar el logro ${row.name}?`)) return; setMessage(''); actions.run(() => send(`/api/admin/achievements/${encodeURIComponent(row.id)}`, {method: 'DELETE'}), () => {setMessage('Logro eliminado.'); refresh();});}}>Eliminar</Button></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack></section>;
}

interface ChallengeForm {name: string; description: string; challenge_type: string; requirement_type: string; requirement_value: number | string; reward_points: number | string; start_date: string; end_date: string; recurrence: string; max_completions: number | string}
export function emptyChallenge(now = new Date()): ChallengeForm {
  return {name: '', description: '', challenge_type: 'limited_time', requirement_type: 'visits', requirement_value: 3, reward_points: 100, start_date: localNow(now), end_date: '', recurrence: '', max_completions: ''};
}
export function challengeIssue(form: ChallengeForm): string | null {
  if (!form.name.trim() || form.name.trim().length > 100) return 'Escribe un nombre de hasta 100 caracteres.';
  if (form.description.trim().length > 500) return 'La descripción admite hasta 500 caracteres.';
  if (!integer(form.requirement_value, 1)) return 'La cantidad requerida es un número entero de 1 o más.';
  if (!integer(form.reward_points, 0)) return 'Los puntos de recompensa son un número entero de 0 o más.';
  const start = toIso(form.start_date);
  if (!start) return 'Indica la fecha de inicio.';
  if (form.end_date) {const end = toIso(form.end_date); if (!end) return 'La fecha de fin no es válida.'; if (end <= start) return 'La fecha de fin debe ser posterior al inicio.';}
  if (form.max_completions !== '' && (!Number.isInteger(Number(form.max_completions)) || Number(form.max_completions) < 1 || Number(form.max_completions) > 1000)) return 'El máximo de cumplimientos va de 1 a 1000.';
  return null;
}
export function challengePayload(form: ChallengeForm) {
  return {
    name: form.name.trim(),
    ...(form.description.trim() ? {description: form.description.trim()} : {}),
    challenge_type: form.challenge_type,
    requirement_type: form.requirement_type,
    requirement_value: Number(form.requirement_value),
    reward_points: Number(form.reward_points),
    start_date: toIso(form.start_date),
    end_date: form.end_date ? toIso(form.end_date) : null,
    recurrence: form.recurrence || null,
    ...(form.max_completions !== '' ? {max_completions: Number(form.max_completions)} : {}),
    active: true,
  };
}
function ChallengeEditor({send, onDone, onCancel, onDirty}: {send: OwnerRequest; onDone: () => void; onCancel: () => void; onDirty?: OwnerPageProps['onDirty']}) {
  const [initial] = useState(() => emptyChallenge());
  const [form, setForm] = useState(initial), [issue, setIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof ChallengeForm>(key: K, value: ChallengeForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  return <section aria-labelledby="owner-challenge-editor"><form onSubmit={event => {event.preventDefault(); const problem = challengeIssue(form); if (problem) {setIssue(problem); return;} mutation.run(() => send('/api/admin/challenges', {method: 'POST', body: JSON.stringify(challengePayload(form))}), onDone);}}>
    <Stack gap="md" maw={680}>
      <Title order={3} id="owner-challenge-editor">Nuevo reto</Title>
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      <TextInput label="Nombre" placeholder="Ej: Fin de semana activo" required maxLength={100} value={form.name} onChange={event => change('name', event.currentTarget.value)} disabled={mutation.busy}/>
      <Textarea label="Descripción (opcional)" placeholder="Visítanos 3 veces este fin de semana" maxLength={500} minRows={2} autosize value={form.description} onChange={event => change('description', event.currentTarget.value)} disabled={mutation.busy}/>
      <NativeSelect label="Tipo de reto" data={challengeTypes} value={form.challenge_type} onChange={event => change('challenge_type', event.currentTarget.value)} disabled={mutation.busy}/>
      <NativeSelect label="Requisito" data={requirementTypes} value={form.requirement_type} onChange={event => change('requirement_type', event.currentTarget.value)} disabled={mutation.busy}/>
      <NumberInput label="Cantidad requerida" min={1} max={1000000} allowDecimal={false} value={form.requirement_value} onChange={value => change('requirement_value', value)} disabled={mutation.busy}/>
      <NumberInput label="Puntos de recompensa" min={0} max={1000000} allowDecimal={false} value={form.reward_points} onChange={value => change('reward_points', value)} disabled={mutation.busy}/>
      <TextInput label="Inicio" type="datetime-local" description={`Fecha y hora de este dispositivo (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`} value={form.start_date} onChange={event => change('start_date', event.currentTarget.value)} disabled={mutation.busy} maw={460}/>
      <TextInput label="Fin (opcional)" type="datetime-local" value={form.end_date} onChange={event => change('end_date', event.currentTarget.value)} disabled={mutation.busy} maw={460}/>
      <NativeSelect label="Recurrencia (para retos recurrentes)" data={recurrences} value={form.recurrence} onChange={event => change('recurrence', event.currentTarget.value)} disabled={mutation.busy}/>
      <NumberInput label="Máximo de cumplimientos por cliente (opcional)" description="Vacío significa sin límite." min={1} max={1000} allowDecimal={false} value={form.max_completions} onChange={value => change('max_completions', value)} disabled={mutation.busy}/>
      <Group><Button type="submit" loading={mutation.busy} disabled={!dirty}>Crear reto</Button><Button variant="default" disabled={mutation.busy} onClick={() => {if (mayDiscard(dirty)) onCancel();}}>Cancelar</Button></Group>
    </Stack>
  </form></section>;
}
function Challenges({send, onDirty}: {send: OwnerRequest; onDirty?: OwnerPageProps['onDirty']}) {
  const [revision, setRevision] = useState(0), [adding, setAdding] = useState(false), [message, setMessage] = useState('');
  const resource = useOwnerResource<{challenges: Challenge[]}>('/api/admin/challenges', revision, send);
  const actions = useOwnerMutation();
  const refresh = () => setRevision(value => value + 1);
  const rows = resource.data?.challenges ?? [];
  return <section aria-labelledby="owner-challenges"><Stack gap="md">
    <Group justify="space-between"><div><Title order={2} id="owner-challenges">Retos</Title><Text c="dimmed" size="sm">Objetivos temporales con una recompensa especial. El listado muestra los retos vigentes.</Text></div><Button onClick={() => {setAdding(true); setMessage('');}} disabled={adding || resource.loading || !!resource.error}>Agregar reto</Button></Group>
    {message && <Alert color="green" role="status">{message}</Alert>}
    {actions.error && <OwnerError error={actions.error}/>}
    {adding && <ChallengeEditor send={send} onDirty={onDirty} onCancel={() => setAdding(false)} onDone={() => {setAdding(false); setMessage('Reto creado. Si empieza más adelante, aparecerá en la lista cuando esté vigente.'); refresh();}}/>}
    {resource.loading ? <OwnerLoading label="Cargando retos…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !rows.length ? <Text>No hay retos vigentes.</Text> : <Table.ScrollContainer minWidth={700} type="native" tabIndex={0} role="region" aria-label="Retos vigentes"><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th scope="col">Reto</Table.Th><Table.Th scope="col">Requisito</Table.Th><Table.Th scope="col">Recompensa</Table.Th><Table.Th scope="col">Vigencia</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={row.id}><Table.Td><Text fw={600}>{row.name}</Text>{row.description && <Text size="sm" c="dimmed">{row.description}</Text>}<Badge variant="light" color="gray" mt={4}>{label(challengeTypes, row.challenge_type)}{row.recurrence ? ` · ${label(recurrences, row.recurrence)}` : ''}</Badge></Table.Td><Table.Td>{label(requirementTypes, row.requirement_type)}: {Number(row.requirement_value).toLocaleString('es-GT')}</Table.Td><Table.Td>+{Number(row.reward_points).toLocaleString('es-GT')} puntos</Table.Td><Table.Td><Text size="sm">{ownerDateTime(row.start_date)}</Text><Text size="sm" c="dimmed">{row.end_date ? `hasta ${ownerDateTime(row.end_date)}` : 'sin fecha de fin'}</Text></Table.Td><Table.Td><Button variant="subtle" color="red" size="compact-sm" disabled={adding || actions.busy} aria-label={`Eliminar reto ${row.name}`} onClick={() => {if (!window.confirm(`¿Eliminar el reto ${row.name}?`)) return; setMessage(''); actions.run(() => send(`/api/admin/challenges/${encodeURIComponent(row.id)}`, {method: 'DELETE'}), () => {setMessage('Reto eliminado.'); refresh();});}}>Eliminar</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack></section>;
}

export default function OwnerGamification({staff, features, onDirty, request: send = request}: OwnerPageProps) {
  const allowed = staff.role === 'OWNER' && features.gamification === true;
  if (!allowed) return <OwnerRestricted title="Logros y retos" owner={staff.role === 'OWNER'}/>;
  return <Stack gap="xl">
    <div><Title order={1}>Logros y retos</Title><Text c="dimmed" mt="sm">Convierte la frecuencia en metas visibles. Los logros premian hábitos; los retos mueven visitas durante una ventana concreta.</Text></div>
    <Achievements send={send} onDirty={onDirty}/>
    <Challenges send={send} onDirty={onDirty}/>
  </Stack>;
}
