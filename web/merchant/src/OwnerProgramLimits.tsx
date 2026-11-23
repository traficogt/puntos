import {useState} from 'react';
import {Alert, Button, Checkbox, Fieldset, Group, NativeSelect, SimpleGrid, Stack, Table, Text, Title} from '@mantine/core';
import {NumberInput} from './inputs';
import {money} from './ui.jsx';
import {merchantRegion} from './region.js';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';

// GET/POST /api/admin/program. The earning rule itself lives in Preparar mi programa; this screen edits
// the safety limits and policies stored next to it in program_json and preserves every other key.
export interface ProgramConfig {
  award_guard?: {max_amount_q?: number; max_points_per_tx?: number; max_visits?: number; max_items?: number; suspicious_points_threshold?: number; suspicious_amount_q_threshold?: number};
  redemption_guard?: {max_redemptions_per_day?: number; max_reward_redemptions_per_day?: number; reward_cooldown_hours?: number};
  balance_policy?: {allow_negative_balance_on_refund?: boolean};
  tier_policy?: {mode?: string; rolling_days?: number; grace_days?: number};
  pending_points_hold_days?: number;
  points_expiration_days?: number;
  [key: string]: unknown;
}
export interface ProgramResponse {program_type: string; program_json: ProgramConfig}
export interface SuspiciousAward {id: string; created_at: string; branch_id?: string | null; branch_name?: string | null; customer_name?: string | null; customer_phone?: string | null; customer_id?: string; staff_name?: string | null; staff_email?: string | null; amount_q?: number | string | null; points: number | string; guard?: {reasons?: string[]} | null}
export interface LimitsForm {
  max_amount_q: number | string; max_points_per_tx: number | string; max_visits: number | string; max_items: number | string;
  suspicious_points_threshold: number | string; suspicious_amount_q_threshold: number | string;
  pending_points_hold_days: number | string; points_expiration_days: number | string;
  max_redemptions_per_day: number | string; max_reward_redemptions_per_day: number | string; reward_cooldown_hours: number | string;
  allow_negative_balance_on_refund: boolean;
  tier_mode: string; tier_rolling_days: number | string; tier_grace_days: number | string;
}
const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const amount = (value: unknown) => Math.max(0, Number(value) || 0);
export function limitsForm(config: ProgramConfig): LimitsForm {
  const guard = config.award_guard ?? {}, redemption = config.redemption_guard ?? {}, tier = config.tier_policy ?? {};
  return {
    max_amount_q: amount(guard.max_amount_q), max_points_per_tx: whole(guard.max_points_per_tx), max_visits: whole(guard.max_visits), max_items: whole(guard.max_items),
    suspicious_points_threshold: whole(guard.suspicious_points_threshold), suspicious_amount_q_threshold: amount(guard.suspicious_amount_q_threshold),
    pending_points_hold_days: whole(config.pending_points_hold_days), points_expiration_days: whole(config.points_expiration_days),
    max_redemptions_per_day: whole(redemption.max_redemptions_per_day), max_reward_redemptions_per_day: whole(redemption.max_reward_redemptions_per_day), reward_cooldown_hours: whole(redemption.reward_cooldown_hours),
    allow_negative_balance_on_refund: config.balance_policy?.allow_negative_balance_on_refund === true,
    tier_mode: tier.mode === 'rolling_days' ? 'rolling_days' : 'lifetime', tier_rolling_days: Number(tier.rolling_days ?? 365), tier_grace_days: whole(tier.grace_days),
  };
}
export function limitsIssue(form: LimitsForm, tiers: boolean): string | null {
  const fields: [keyof LimitsForm, string][] = [['max_points_per_tx', 'Puntos máximos por transacción'], ['max_visits', 'Visitas máximas'], ['max_items', 'Artículos máximos'], ['suspicious_points_threshold', 'Alerta por puntos'], ['pending_points_hold_days', 'Días para liberar puntos'], ['points_expiration_days', 'Días para vencer puntos'], ['max_redemptions_per_day', 'Canjes por cliente al día'], ['max_reward_redemptions_per_day', 'Canjes del mismo premio al día'], ['reward_cooldown_hours', 'Horas de enfriamiento']];
  for (const [key, label] of fields) if (!Number.isInteger(Number(form[key])) || Number(form[key]) < 0) return `${label}: usa un número entero de 0 o más.`;
  for (const [key, label] of [['max_amount_q', 'Monto máximo por transacción'], ['suspicious_amount_q_threshold', 'Alerta por monto']] as const) if (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0) return `${label}: usa un monto de 0 o más.`;
  if (tiers && form.tier_mode === 'rolling_days' && (!Number.isInteger(Number(form.tier_rolling_days)) || Number(form.tier_rolling_days) < 30)) return 'La ventana móvil de niveles es de al menos 30 días.';
  if (tiers && (!Number.isInteger(Number(form.tier_grace_days)) || Number(form.tier_grace_days) < 0)) return 'Los días de gracia son un número entero de 0 o más.';
  return null;
}
/** Spreads the stored configuration first so the earning rule, lifecycle and campaign rules survive the save. */
export function limitsPayload(program: ProgramResponse, form: LimitsForm, tiers: boolean) {
  const base = {...program.program_json};
  delete base.pos_integration; delete base.external_awards; delete base.weekly_owner_brief;
  return {
    program_type: program.program_type,
    program_json: {
      ...base,
      pending_points_hold_days: whole(form.pending_points_hold_days),
      points_expiration_days: whole(form.points_expiration_days),
      award_guard: {max_amount_q: amount(form.max_amount_q), max_points_per_tx: whole(form.max_points_per_tx), max_visits: whole(form.max_visits), max_items: whole(form.max_items), suspicious_points_threshold: whole(form.suspicious_points_threshold), suspicious_amount_q_threshold: amount(form.suspicious_amount_q_threshold)},
      redemption_guard: {max_redemptions_per_day: whole(form.max_redemptions_per_day), max_reward_redemptions_per_day: whole(form.max_reward_redemptions_per_day), reward_cooldown_hours: whole(form.reward_cooldown_hours)},
      balance_policy: {allow_negative_balance_on_refund: form.allow_negative_balance_on_refund},
      ...(tiers ? {tier_policy: {mode: form.tier_mode, rolling_days: Math.max(30, whole(form.tier_rolling_days) || 365), grace_days: whole(form.tier_grace_days)}} : {}),
    },
  };
}
const orNone = (value: number | string, unit = '') => Number(value) > 0 ? `${Number(value).toLocaleString('es-GT')}${unit}` : 'sin límite';

function LimitsEditor({program, features, send, onDirty, onSaved}: {program: ProgramResponse; features: Record<string, boolean>; send: OwnerRequest; onDirty?: OwnerPageProps['onDirty']; onSaved: () => void}) {
  const initial = limitsForm(program.program_json ?? {});
  const [form, setForm] = useState(initial), [issue, setIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const tiers = features.tiers === true, currency = merchantRegion().currency;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof LimitsForm>(key: K, value: LimitsForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  const numberField = (key: keyof LimitsForm, label: string, description?: string, moneyField = false) => <NumberInput key={key} label={label} description={description} min={0} allowNegative={false} allowDecimal={moneyField} decimalScale={moneyField ? merchantRegion().minorUnits : 0} value={form[key] as number | string} onChange={value => change(key, value as never)} disabled={mutation.busy}/>;
  return <form onSubmit={event => {event.preventDefault(); const problem = limitsIssue(form, tiers); if (problem) {setIssue(problem); return;} mutation.run(() => send('/api/admin/program', {method: 'POST', body: JSON.stringify(limitsPayload(program, form, tiers))}), onSaved);}}>
    <Stack gap="lg">
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      <SimpleGrid cols={{base: 1, lg: 2}} spacing="lg">
        <Fieldset legend="Límites por transacción" disabled={mutation.busy}><Stack gap="md">
          <Text size="sm" c="dimmed">Protegen contra errores de captura. 0 significa sin límite.</Text>
          {numberField('max_amount_q', `Monto máximo por transacción (${currency})`, undefined, true)}
          {numberField('max_points_per_tx', 'Puntos máximos por transacción')}
          {numberField('max_visits', 'Visitas máximas por transacción')}
          {numberField('max_items', 'Artículos máximos por transacción')}
        </Stack></Fieldset>
        <Fieldset legend="Alertas de sospecha" disabled={mutation.busy}><Stack gap="md">
          <Text size="sm" c="dimmed">Las transacciones que alcancen estos valores se marcan para revisión. 0 desactiva la alerta.</Text>
          {numberField('suspicious_points_threshold', 'Marcar si los puntos son al menos')}
          {numberField('suspicious_amount_q_threshold', `Marcar si el monto es al menos (${currency})`, undefined, true)}
        </Stack></Fieldset>
        <Fieldset legend="Puntos pendientes y vencimiento" disabled={mutation.busy}><Stack gap="md">
          {numberField('pending_points_hold_days', 'Días para liberar puntos', '0 libera los puntos de inmediato.')}
          {numberField('points_expiration_days', 'Días para vencer puntos', '0 significa que nunca vencen.')}
        </Stack></Fieldset>
        <Fieldset legend="Canjes: límites y enfriamiento" disabled={mutation.busy}><Stack gap="md">
          {numberField('max_redemptions_per_day', 'Canjes máximos por cliente al día', '0 significa sin límite.')}
          {numberField('max_reward_redemptions_per_day', 'Canjes máximos del mismo premio al día', '0 significa sin límite.')}
          {numberField('reward_cooldown_hours', 'Enfriamiento del mismo premio (horas)', '0 significa sin enfriamiento.')}
        </Stack></Fieldset>
        <Fieldset legend="Política de saldo" disabled={mutation.busy}><Stack gap="md">
          <Checkbox label="Permitir saldo negativo al reembolsar compras ya consumidas" description="Si está apagado, un reembolso que dejaría al cliente en negativo se bloquea." checked={form.allow_negative_balance_on_refund} onChange={event => change('allow_negative_balance_on_refund', event.currentTarget.checked)}/>
        </Stack></Fieldset>
        {tiers && <Fieldset legend="Política de niveles" disabled={mutation.busy}><Stack gap="md">
          <NativeSelect label="Cómo se calcula el nivel" data={[{value: 'lifetime', label: 'Acumulado histórico'}, {value: 'rolling_days', label: 'Ventana móvil'}]} value={form.tier_mode} onChange={event => change('tier_mode', event.currentTarget.value)}/>
          {form.tier_mode === 'rolling_days' && numberField('tier_rolling_days', 'Días de la ventana', 'Al menos 30 días.')}
          {numberField('tier_grace_days', 'Días de gracia antes de bajar de nivel')}
        </Stack></Fieldset>}
      </SimpleGrid>
      <Stack gap={4} className="panel" p="md" maw={720}>
        <Text fw={600}>Resumen</Text>
        <Text size="sm">Límites: máximo {orNone(form.max_points_per_tx, ' puntos')} por transacción; monto máximo {Number(form.max_amount_q) > 0 ? money(Number(form.max_amount_q)) : 'sin límite'}.</Text>
        <Text size="sm">Alertas: puntos ≥ {Number(form.suspicious_points_threshold) > 0 ? Number(form.suspicious_points_threshold).toLocaleString('es-GT') : 'desactivada'}; monto ≥ {Number(form.suspicious_amount_q_threshold) > 0 ? money(Number(form.suspicious_amount_q_threshold)) : 'desactivada'}.</Text>
        <Text size="sm">Vencimiento: {Number(form.points_expiration_days) > 0 ? `${Number(form.points_expiration_days)} días` : 'desactivado'}. Liberación: {Number(form.pending_points_hold_days) > 0 ? `${Number(form.pending_points_hold_days)} días` : 'inmediata'}.</Text>
        <Text size="sm">Canjes: {orNone(form.max_redemptions_per_day)} por cliente al día; {orNone(form.max_reward_redemptions_per_day)} del mismo premio al día; enfriamiento de {Number(form.reward_cooldown_hours) || 0} h.</Text>
        <Text size="sm">Reembolsos: saldo negativo {form.allow_negative_balance_on_refund ? 'permitido' : 'bloqueado'}.</Text>
      </Stack>
      <Group><Button type="submit" loading={mutation.busy} disabled={!dirty}>Guardar límites y políticas</Button><Button variant="default" disabled={!dirty || mutation.busy} onClick={() => {setForm(initial); setIssue(null); mutation.clear();}}>Descartar cambios</Button></Group>
    </Stack>
  </form>;
}

function SuspiciousAwards({send, revision, onRefresh}: {send: OwnerRequest; revision: number; onRefresh: () => void}) {
  const resource = useOwnerResource<{awards: SuspiciousAward[]}>('/api/admin/awards/suspicious?limit=30', revision, send);
  const rows = resource.data?.awards ?? [];
  return <section aria-labelledby="owner-suspicious-awards"><Stack gap="md">
    <Group justify="space-between"><div><Title order={2} id="owner-suspicious-awards">Transacciones marcadas</Title><Text size="sm" c="dimmed">Compras registradas que alcanzaron una alerta de sospecha. Revísalas con tu equipo; aquí no se revierten.</Text></div><Button variant="outline" onClick={onRefresh} loading={resource.loading}>Actualizar</Button></Group>
    {resource.loading ? <OwnerLoading label="Consultando transacciones marcadas…"/> : resource.error ? <OwnerError error={resource.error} retry={onRefresh}/> : !rows.length ? <Text>Sin transacciones marcadas.</Text> : <Table.ScrollContainer minWidth={760} type="native" tabIndex={0} role="region" aria-label="Transacciones marcadas como sospechosas"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Sucursal</Table.Th><Table.Th scope="col">Registró</Table.Th><Table.Th scope="col">Cliente</Table.Th><Table.Th scope="col" ta="right">Puntos</Table.Th><Table.Th scope="col" ta="right">Monto</Table.Th><Table.Th scope="col">Motivos</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={row.id}><Table.Td>{ownerDateTime(row.created_at)}</Table.Td><Table.Td>{row.branch_name || (row.branch_id ? 'Sucursal asignada' : 'Sin sucursal')}</Table.Td><Table.Td>{row.staff_name || row.staff_email || 'Equipo'}</Table.Td><Table.Td>{row.customer_name || row.customer_phone || 'Cliente'}</Table.Td><Table.Td ta="right">+{Number(row.points).toLocaleString('es-GT')}</Table.Td><Table.Td ta="right">{money(Number(row.amount_q ?? 0))}</Table.Td><Table.Td><Text size="sm">{(row.guard?.reasons ?? []).join(', ') || '—'}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack></section>;
}

export default function OwnerProgramLimits({staff, features, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [suspiciousRevision, setSuspiciousRevision] = useState(0), [saved, setSaved] = useState(false);
  const allowed = staff.role === 'OWNER' && features.program_rules === true;
  const resource = useOwnerResource<ProgramResponse>(allowed ? '/api/admin/program' : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Límites y políticas" owner={staff.role === 'OWNER'}/>;
  return <Stack gap="xl">
    <div><Title order={1}>Límites y políticas</Title><Text c="dimmed" mt="sm" maw={760}>Salvaguardas de tu programa: topes por transacción, alertas, vencimiento de puntos, límites de canje y política de reembolsos. La regla de puntos se edita en Preparar mi programa.</Text></div>
    {saved && <Alert color="green" role="status">Límites y políticas guardados. Se aplican a las próximas compras y canjes.</Alert>}
    {resource.loading ? <OwnerLoading label="Cargando configuración…"/> : resource.error ? <OwnerError error={resource.error} retry={() => setRevision(value => value + 1)}/> : resource.data && <LimitsEditor key={revision} program={resource.data} features={features} send={send} onDirty={onDirty} onSaved={() => {setSaved(true); setRevision(value => value + 1); setSuspiciousRevision(value => value + 1);}}/>}
    {features.fraud_monitoring && <SuspiciousAwards send={send} revision={suspiciousRevision} onRefresh={() => setSuspiciousRevision(value => value + 1)}/>}
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('launch')}>Editar la regla de puntos</Button>{features.tiers && <Button variant="subtle" onClick={() => onNavigate('tiers')}>Ver niveles de cliente</Button>}</Group>}
  </Stack>;
}
