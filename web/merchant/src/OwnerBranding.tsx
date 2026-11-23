import {useState} from 'react';
import {Alert, Button, Checkbox, ColorInput, Group, NativeSelect, SimpleGrid, Stack, Text, TextInput, Title} from '@mantine/core';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, OwnerLoading, OwnerError, OwnerRestricted} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';

// Mirrors businessCustomerBrandingSchema (src/utils/schemas.js) behind GET/PUT /api/admin/branding.
export type BrandingMode = 'platform_led' | 'endorsed_brand' | 'white_label_ready';
export type NeutralTheme = 'warm' | 'neutral' | 'cool';
export interface CustomerBranding {
  branding_mode?: BrandingMode;
  customer_program_name?: string;
  customer_logo_url?: string;
  qr_logo_enabled?: boolean;
  primary_color?: string;
  accent_color?: string;
  neutral_theme?: NeutralTheme;
  powered_by_visible?: boolean;
  wallet_headline?: string;
  join_headline?: string;
}
export interface BrandingForm {
  branding_mode: BrandingMode;
  customer_program_name: string;
  customer_logo_url: string;
  qr_logo_enabled: boolean;
  primary_color: string;
  accent_color: string;
  neutral_theme: NeutralTheme;
  powered_by_visible: boolean;
  wallet_headline: string;
  join_headline: string;
}
const modes = [
  {value: 'platform_led', label: 'PuntosFieles visible'},
  {value: 'endorsed_brand', label: 'Tu negocio con «Powered by PuntosFieles»'},
  {value: 'white_label_ready', label: 'Tu negocio al frente'},
];
const modeHints: Record<BrandingMode, string> = {
  platform_led: 'PuntosFieles lidera la experiencia y tu negocio aparece como programa participante.',
  endorsed_brand: 'La experiencia muestra tu negocio y mantiene a PuntosFieles como respaldo visible.',
  white_label_ready: 'Tu negocio queda al frente y PuntosFieles puede pasar a una mención mínima.',
};
const themes = [{value: 'warm', label: 'Cálido'}, {value: 'neutral', label: 'Neutral'}, {value: 'cool', label: 'Frío'}];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const isMode = (value: string): value is BrandingMode => value === 'platform_led' || value === 'endorsed_brand' || value === 'white_label_ready';
const isTheme = (value: string): value is NeutralTheme => value === 'warm' || value === 'neutral' || value === 'cool';

export function brandingForm(branding: CustomerBranding): BrandingForm {
  return {
    branding_mode: branding.branding_mode ?? 'endorsed_brand',
    customer_program_name: branding.customer_program_name ?? '',
    customer_logo_url: branding.customer_logo_url ?? '',
    qr_logo_enabled: branding.qr_logo_enabled === true,
    primary_color: branding.primary_color ?? '',
    accent_color: branding.accent_color ?? '',
    neutral_theme: branding.neutral_theme ?? 'warm',
    powered_by_visible: branding.powered_by_visible !== false,
    wallet_headline: branding.wallet_headline ?? '',
    join_headline: branding.join_headline ?? '',
  };
}
const optional = (value: string) => (value.trim() ? value.trim() : undefined);
export function brandingIssue(form: BrandingForm): string | null {
  if (form.customer_logo_url.trim() && !/^https:\/\//i.test(form.customer_logo_url.trim())) return 'El logotipo debe ser un enlace https.';
  if (form.primary_color.trim() && !HEX.test(form.primary_color.trim())) return 'Usa un color principal hexadecimal de seis dígitos, por ejemplo #6D3524.';
  if (form.accent_color.trim() && !HEX.test(form.accent_color.trim())) return 'Usa un color de acento hexadecimal de seis dígitos, por ejemplo #D7A554.';
  return null;
}
export function brandingPayload(form: BrandingForm, qrLogoAllowed: boolean): CustomerBranding {
  return {
    branding_mode: form.branding_mode,
    customer_program_name: optional(form.customer_program_name),
    customer_logo_url: optional(form.customer_logo_url),
    qr_logo_enabled: qrLogoAllowed && form.qr_logo_enabled,
    primary_color: optional(form.primary_color)?.toUpperCase(),
    accent_color: optional(form.accent_color)?.toUpperCase(),
    neutral_theme: form.neutral_theme,
    powered_by_visible: form.powered_by_visible,
    wallet_headline: optional(form.wallet_headline),
    join_headline: optional(form.join_headline),
  };
}

function BrandingEditor({branding, plan, features, send, onDirty, onSaved}: {branding: CustomerBranding; plan?: string; features: Record<string, boolean>; send: OwnerRequest; onDirty?: OwnerPageProps['onDirty']; onSaved: () => void}) {
  const initial = brandingForm(branding);
  const [form, setForm] = useState(initial), [issue, setIssue] = useState<string | null>(null);
  const mutation = useOwnerMutation();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  // Premium branding follows the branded-QR feature (Negocio+); the logo inside the QR stays Empresa-only, as the server enforces.
  const premium = features.branded_qr === true, qrLogoAllowed = String(plan || '').toUpperCase() === 'EMPRESA';
  const programName = form.customer_program_name.trim() || 'el nombre de tu negocio';
  return <form onSubmit={event => {event.preventDefault(); const problem = brandingIssue(form); if (problem) {setIssue(problem); return;} mutation.run(() => send<{customer_branding?: CustomerBranding}>('/api/admin/branding', {method: 'PUT', body: JSON.stringify(brandingPayload(form, qrLogoAllowed))}), onSaved);}}>
    <SimpleGrid cols={{base: 1, md: 2}} spacing="xl">
      <Stack gap="md">
        <Text size="sm">{premium ? 'Tu plan ya permite la identidad premium en las pantallas del cliente.' : 'La identidad premium en las pantallas del cliente se habilita en los planes Negocio y Empresa. Puedes guardar tu preferencia desde ahora.'}</Text>
        {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
        <NativeSelect label="Modo de marca" description={modeHints[form.branding_mode]} data={modes} value={form.branding_mode} onChange={event => {const value = event.currentTarget.value; if (isMode(value)) change('branding_mode', value);}} disabled={mutation.busy}/>
        <TextInput label="Nombre del programa" placeholder="Ej: Recompensas Café Bourbon" maxLength={120} value={form.customer_program_name} onChange={event => change('customer_program_name', event.currentTarget.value)} disabled={mutation.busy}/>
        <TextInput label="Logotipo del negocio (enlace https)" placeholder="https://cdn.tunegocio.com/logo.png" maxLength={1000} inputMode="url" value={form.customer_logo_url} onChange={event => change('customer_logo_url', event.currentTarget.value)} disabled={mutation.busy}/>
        <Checkbox label="Insertar el logotipo dentro del QR del cliente" description={qrLogoAllowed ? 'Tu plan permite el QR premium con logotipo, siempre con un respaldo seguro si el logotipo no es válido.' : 'El logotipo dentro del QR se reserva para el plan Empresa.'} checked={qrLogoAllowed && form.qr_logo_enabled} onChange={event => change('qr_logo_enabled', event.currentTarget.checked)} disabled={mutation.busy || !qrLogoAllowed}/>
        <ColorInput label="Color principal" placeholder="#6D3524" format="hex" value={form.primary_color} onChange={value => change('primary_color', value)} disabled={mutation.busy}/>
        <ColorInput label="Color de acento" placeholder="#D7A554" format="hex" value={form.accent_color} onChange={value => change('accent_color', value)} disabled={mutation.busy}/>
        <NativeSelect label="Tema neutral" data={themes} value={form.neutral_theme} onChange={event => {const value = event.currentTarget.value; if (isTheme(value)) change('neutral_theme', value);}} disabled={mutation.busy}/>
        <Checkbox label="Mostrar «Powered by PuntosFieles»" checked={form.powered_by_visible} onChange={event => change('powered_by_visible', event.currentTarget.checked)} disabled={mutation.busy}/>
        <TextInput label="Titular de la tarjeta" placeholder="Tus puntos en un solo lugar" maxLength={140} value={form.wallet_headline} onChange={event => change('wallet_headline', event.currentTarget.value)} disabled={mutation.busy}/>
        <TextInput label="Titular del registro" placeholder="Únete y gana beneficios" maxLength={140} value={form.join_headline} onChange={event => change('join_headline', event.currentTarget.value)} disabled={mutation.busy}/>
        <Group><Button type="submit" loading={mutation.busy} disabled={!dirty}>Guardar identidad</Button><Button variant="default" disabled={!dirty || mutation.busy} onClick={() => {setForm(initial); setIssue(null); mutation.clear();}}>Descartar cambios</Button></Group>
      </Stack>
      <Stack gap="xs" className="panel" p="md" style={{alignSelf: 'start'}}>
        <Title order={2} size="h3">Vista rápida</Title>
        <Text size="sm">Modo: {modes.find(mode => mode.value === form.branding_mode)?.label}</Text>
        <Text size="sm">Programa: {programName}</Text>
        <Text size="sm">Titular de la tarjeta: {form.wallet_headline.trim() || 'predeterminado'}</Text>
        <Text size="sm">Titular del registro: {form.join_headline.trim() || 'predeterminado'}</Text>
        <Text size="sm">«Powered by»: {form.powered_by_visible ? 'visible' : 'oculto'}</Text>
        <Group gap="xs">{[form.primary_color, form.accent_color].filter(color => HEX.test(color.trim())).map(color => <span key={color} aria-hidden="true" style={{display: 'inline-block', width: 24, height: 24, borderRadius: 6, background: color, border: '1px solid var(--mantine-color-default-border)'}}/>)}</Group>
        <Text size="xs" c="dimmed">Esta identidad solo cambia lo que ve el cliente en el registro y en su tarjeta; no modifica reglas ni saldos.</Text>
      </Stack>
    </SimpleGrid>
  </form>;
}

export default function OwnerBranding({staff, features, plan, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [saved, setSaved] = useState(false);
  const allowed = staff.role === 'OWNER';
  const resource = useOwnerResource<{customer_branding?: CustomerBranding}>(allowed ? '/api/admin/branding' : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Identidad del programa" owner={false}/>;
  return <Stack gap="xl">
    <div><Title order={1}>Identidad del programa</Title><Text c="dimmed" mt="sm">Define cómo ven tu programa los clientes en la página de registro y en su tarjeta. La estructura no cambia; aquí ajustas la intensidad de tu marca y los textos visibles.</Text></div>
    {saved && <Alert color="green" role="status">Identidad guardada.</Alert>}
    {resource.loading ? <OwnerLoading label="Cargando identidad…"/> : resource.error ? <OwnerError error={resource.error} retry={() => setRevision(v => v + 1)}/> : <BrandingEditor key={revision} branding={resource.data?.customer_branding || {}} plan={plan} features={features} send={send} onDirty={onDirty} onSaved={() => {setSaved(true); setRevision(v => v + 1);}}/>}
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('brand')}>Preparar un QR con tu marca</Button><Button variant="subtle" onClick={() => onNavigate('launch')}>Ver el QR y el enlace de registro</Button></Group>}
  </Stack>;
}
