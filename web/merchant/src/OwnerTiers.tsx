import {useState} from 'react';
import {Alert, Badge, Button, Group, Stack, Table, Text, Textarea, TextInput, Title} from '@mantine/core';
import {NumberInput} from './inputs';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, mayDiscard, OwnerLoading, OwnerError, OwnerRestricted} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';

// GET /api/admin/tiers returns every tier's full rule (min_points, points_multiplier, perks, color,
// icon_url, ...) next to its statistics (customer_count, avg_points, total_points), so the editor
// prefills from the list; POST/PUT answer with the row alone. Numeric columns may arrive as strings.
// Optional markers stay so an older server that sent statistics only still renders.
export interface Tier {
  id: string;
  name: string;
  tier_level: number | string;
  min_points?: number | string | null;
  min_spend?: number | string | null;
  min_visits?: number | string | null;
  points_multiplier?: number | string | null;
  perks?: string[] | null;
  color?: string | null;
  icon_url?: string | null;
  active?: boolean;
  customer_count?: number | string | null;
  avg_points?: number | string | null;
  total_points?: number | string | null;
}
export interface TierForm {name: string; tier_level: number | string; min_points: number | string; points_multiplier: number | string; color: string; icon_url: string; perks: string}
const HEX = /^#[0-9A-Fa-f]{6}$/;
const count = (value: number | string | null | undefined) => (value == null || value === '' ? null : Number(value));
export const perkList = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
export function tierForm(tier: Tier | null, nextLevel: number): TierForm {
  return {
    name: tier?.name ?? '',
    tier_level: tier ? Number(tier.tier_level) : nextLevel,
    min_points: count(tier?.min_points) ?? (tier ? '' : 5000),
    points_multiplier: count(tier?.points_multiplier) ?? (tier ? '' : 2),
    color: tier?.color ?? '',
    icon_url: tier?.icon_url ?? '',
    perks: Array.isArray(tier?.perks) ? tier.perks.join('\n') : '',
  };
}
export function tierIssue(form: TierForm, editing: boolean): string | null {
  const name = form.name.trim();
  if (name.length < 1 || name.length > 50) return 'Escribe un nombre de hasta 50 caracteres.';
  const level = Number(form.tier_level);
  if (!editing && (!Number.isInteger(level) || level < 1 || level > 100)) return 'El orden del nivel es un número entero de 1 a 100.';
  const minimum = Number(form.min_points);
  if (form.min_points !== '' && (!Number.isInteger(minimum) || minimum < 0)) return 'Los puntos mínimos son un número entero de 0 o más.';
  const multiplier = Number(form.points_multiplier);
  if (form.points_multiplier !== '' && (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 20)) return 'El multiplicador va de 1 a 20.';
  if (form.color.trim() && !HEX.test(form.color.trim())) return 'Usa un color hexadecimal de seis dígitos, por ejemplo #E5E4E2.';
  if (form.icon_url.trim().length > 300) return 'El icono admite hasta 300 caracteres.';
  const perks = perkList(form.perks);
  if (perks.length > 30 || perks.some(perk => perk.length > 200)) return 'Hasta 30 beneficios de 200 caracteres cada uno.';
  return null;
}
/** Creation sends the whole rule; an edit sends only what changed, so untouched values stay as stored. */
export function tierPayload(form: TierForm, initial: TierForm, editing: boolean) {
  const payload: Record<string, unknown> = {};
  const changed = (key: keyof TierForm) => !editing || JSON.stringify(form[key]) !== JSON.stringify(initial[key]);
  if (changed('name')) payload.name = form.name.trim();
  if (!editing) payload.tier_level = Number(form.tier_level);
  if (changed('min_points') && form.min_points !== '') payload.min_points = Number(form.min_points);
  if (changed('points_multiplier') && form.points_multiplier !== '') payload.points_multiplier = Number(form.points_multiplier);
  if (changed('perks')) payload.perks = perkList(form.perks);
  if (changed('color')) payload.color = form.color.trim() ? form.color.trim().toUpperCase() : null;
  if (changed('icon_url')) payload.icon_url = form.icon_url.trim() || null;
  return payload;
}

function TierEditor({tier, nextLevel, send, onDone, onCancel, onDirty}: {tier: Tier | null; nextLevel: number; send: OwnerRequest; onDone: (created: boolean) => void; onCancel: () => void; onDirty?: OwnerPageProps['onDirty']}) {
  const initial = tierForm(tier, nextLevel);
  const [form, setForm] = useState(initial), [issue, setIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof TierForm>(key: K, value: TierForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  return <section aria-labelledby="owner-tier-editor"><form onSubmit={event => {event.preventDefault(); const problem = tierIssue(form, !!tier); if (problem) {setIssue(problem); return;} mutation.run(() => send(`/api/admin/tiers${tier ? `/${encodeURIComponent(tier.id)}` : ''}`, {method: tier ? 'PUT' : 'POST', body: JSON.stringify(tierPayload(form, initial, !!tier))}), () => onDone(!tier));}}>
    <Stack gap="md" maw={680}>
      <Title order={2} id="owner-tier-editor">{tier ? `Editar nivel ${tier.name}` : 'Nuevo nivel'}</Title>
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      <TextInput label="Nombre" placeholder="Ej: Platino" required maxLength={50} value={form.name} onChange={event => change('name', event.currentTarget.value)} disabled={mutation.busy}/>
      <NumberInput label="Orden del nivel" description={tier ? 'El orden no se puede cambiar después de crear el nivel.' : 'Un número mayor es un nivel más alto. Cada orden se usa una sola vez.'} min={1} max={100} allowDecimal={false} value={form.tier_level} onChange={value => change('tier_level', value)} disabled={mutation.busy || !!tier}/>
      <NumberInput label="Puntos mínimos" description="Puntos acumulados para alcanzar el nivel." min={0} allowDecimal={false} value={form.min_points} onChange={value => change('min_points', value)} disabled={mutation.busy}/>
      <NumberInput label="Multiplicador de puntos" description="Con 2, cada compra suma el doble de puntos." min={1} max={20} step={0.25} decimalScale={2} value={form.points_multiplier} onChange={value => change('points_multiplier', value)} disabled={mutation.busy}/>
      <TextInput label="Color (hexadecimal, opcional)" placeholder="#E5E4E2" maxLength={7} value={form.color} onChange={event => change('color', event.currentTarget.value)} disabled={mutation.busy}/>
      <TextInput label="Icono (emoji o enlace, opcional)" placeholder="💎" maxLength={300} value={form.icon_url} onChange={event => change('icon_url', event.currentTarget.value)} disabled={mutation.busy}/>
      <Textarea label="Beneficios (uno por línea)" placeholder={'Doble puntos\nEnvío gratis\nDescuentos exclusivos'} minRows={3} autosize value={form.perks} onChange={event => change('perks', event.currentTarget.value)} disabled={mutation.busy}/>
      {tier && <Text size="sm" c="dimmed">Los campos que dejes como están se conservan tal como fueron guardados.</Text>}
      <Group><Button type="submit" loading={mutation.busy} disabled={!dirty}>{tier ? 'Guardar nivel' : 'Crear nivel'}</Button><Button variant="default" disabled={mutation.busy} onClick={() => {if (mayDiscard(dirty)) onCancel();}}>Cancelar</Button></Group>
    </Stack>
  </form></section>;
}

export default function OwnerTiers({staff, features, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [editor, setEditor] = useState<Tier | null | undefined>(undefined), [message, setMessage] = useState('');
  const allowed = staff.role === 'OWNER' && features.tiers === true;
  const resource = useOwnerResource<{tiers: Tier[]}>(allowed ? '/api/admin/tiers' : null, revision, send);
  const actions = useOwnerMutation();
  if (!allowed) return <OwnerRestricted title="Niveles de cliente" owner={staff.role === 'OWNER'}/>;
  const tiers = resource.data?.tiers ?? [];
  const nextLevel = tiers.reduce((top, tier) => Math.max(top, Number(tier.tier_level) || 0), 0) + 1;
  const refresh = () => setRevision(value => value + 1);
  function remove(tier: Tier) {
    if (!window.confirm(`¿Eliminar el nivel ${tier.name}? Solo se puede eliminar si no tiene clientes asignados.`)) return;
    setMessage('');
    actions.run(() => send(`/api/admin/tiers/${encodeURIComponent(tier.id)}`, {method: 'DELETE'}), () => {setMessage('Nivel eliminado.'); refresh();});
  }
  return <Stack gap="xl">
    <Group justify="space-between"><div><Title order={1}>Niveles de cliente</Title><Text c="dimmed" mt="sm">Tus clientes avanzan de nivel automáticamente según sus puntos acumulados. Cada nivel puede multiplicar los puntos y describir sus beneficios.</Text></div><Button onClick={() => {setEditor(null); setMessage('');}} disabled={editor !== undefined || resource.loading || !!resource.error}>Agregar nivel</Button></Group>
    {message && <Alert color="green" role="status">{message}</Alert>}
    {actions.error && <OwnerError error={actions.error}/>}
    {editor !== undefined && <TierEditor key={editor?.id || 'new'} tier={editor} nextLevel={nextLevel} send={send} onDirty={onDirty} onCancel={() => setEditor(undefined)} onDone={created => {setEditor(undefined); setMessage(created ? 'Nivel creado.' : 'Nivel actualizado.'); refresh();}}/>}
    {resource.loading ? <OwnerLoading label="Cargando niveles…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !tiers.length ? <Text>Todavía no hay niveles. Crea el primero para que tus clientes tengan una meta visible.</Text> : <Table.ScrollContainer minWidth={640} type="native" tabIndex={0} role="region" aria-label="Niveles del programa"><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th scope="col">Nivel</Table.Th><Table.Th scope="col">Puntos mínimos</Table.Th><Table.Th scope="col">Multiplicador</Table.Th><Table.Th scope="col">Clientes</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{tiers.map(tier => {
      const minimum = count(tier.min_points), multiplier = count(tier.points_multiplier), customers = count(tier.customer_count) ?? 0;
      return <Table.Tr key={tier.id}><Table.Td><Group gap="xs" wrap="nowrap"><span aria-hidden="true">{tier.icon_url && !/^https?:/i.test(tier.icon_url) ? tier.icon_url : '⭐'}</span><div><Text fw={600}>{tier.name}</Text><Badge variant="light" color="gray">Nivel {Number(tier.tier_level)}</Badge></div></Group>{Array.isArray(tier.perks) && tier.perks.length > 0 && <Text size="sm" c="dimmed" mt="xs">Beneficios: {tier.perks.join(', ')}</Text>}</Table.Td><Table.Td>{minimum == null ? '—' : `${minimum.toLocaleString('es-GT')}+`}</Table.Td><Table.Td>{multiplier == null ? '—' : `${multiplier}×`}</Table.Td><Table.Td>{customers.toLocaleString('es-GT')}</Table.Td><Table.Td><Group gap="xs"><Button variant="default" size="compact-sm" disabled={editor !== undefined || actions.busy} aria-label={`Editar nivel ${tier.name}`} onClick={() => {setEditor(tier); setMessage('');}}>Editar</Button><Button variant="subtle" color="red" size="compact-sm" disabled={editor !== undefined || actions.busy || customers > 0} aria-label={`Eliminar nivel ${tier.name}`} onClick={() => remove(tier)}>Eliminar</Button></Group></Table.Td></Table.Tr>;
    })}</Table.Tbody></Table></Table.ScrollContainer>}
    <Text size="sm" c="dimmed">La política de niveles (acumulado histórico o ventana móvil) se ajusta en Límites y políticas.</Text>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('limits')}>Abrir límites y políticas</Button></Group>}
  </Stack>;
}
