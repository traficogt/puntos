import {useRef, useState} from 'react';
import {Alert, Badge, Button, Group, SimpleGrid, Stack, Table, Text, TextInput, Title} from '@mantine/core';
import {NumberInput} from './inputs';
import {money} from './ui.jsx';
import {merchantRegion} from './region.js';
import {request, useOwnerResource, useOwnerMutation, useOwnerDirty, mayDiscard, OwnerLoading, OwnerError, OwnerRestricted, ownerDateTime} from './owner-workspace';
import type {OwnerPageProps, OwnerRequest} from './owner-workspace';

// gift_cards / gift_card_transactions rows (src/app/schema.sql); NUMERIC columns arrive as strings.
export interface GiftCard {id: string; code: string; qr_token?: string; balance_q: number | string; initial_amount_q: number | string; status?: string; created_at: string; issued_to_name?: string | null; issued_to_phone?: string | null; expires_at?: string | null}
export interface GiftCardTransaction {id: string; tx_type: string; amount_q: number | string; balance_after_q: number | string; created_at: string}
export interface GiftCardLedger {card: GiftCard; ledger: {stored_balance_q: number; expected_balance_q: number; issue_total_q: number; redeem_total_q: number; delta_q: number; mismatch: boolean}; transactions: GiftCardTransaction[]}
interface GiftCardForm {amount_q: number | string; issued_to_name: string; issued_to_phone: string}
const emptyForm: GiftCardForm = {amount_q: 50, issued_to_name: '', issued_to_phone: ''};
const statusLabel = (status?: string) => status === 'ACTIVE' || !status ? 'Activa' : status === 'EXPIRED' ? 'Vencida' : status === 'REDEEMED' || status === 'EMPTY' ? 'Agotada' : status;
const amount = (value: number | string | null | undefined) => money(Number(value ?? 0));
export function giftCardIssue(form: GiftCardForm): string | null {
  const value = Number(form.amount_q);
  if (form.amount_q === '' || !Number.isFinite(value) || value <= 0) return 'Indica un monto inicial mayor que cero.';
  if (form.issued_to_name.trim().length > 120) return 'El nombre admite hasta 120 caracteres.';
  const phone = form.issued_to_phone.trim();
  if (phone && (phone.length < 6 || phone.length > 30)) return 'El teléfono debe tener entre 6 y 30 caracteres.';
  return null;
}
export function giftCardPayload(form: GiftCardForm, requestId: string) {
  return {amount_q: Number(form.amount_q), ...(form.issued_to_name.trim() ? {issued_to_name: form.issued_to_name.trim()} : {}), ...(form.issued_to_phone.trim() ? {issued_to_phone: form.issued_to_phone.trim()} : {}), requestId};
}

function IssueForm({send, onDone, onCancel, onDirty}: {send: OwnerRequest; onDone: (card: GiftCard) => void; onCancel: () => void; onDirty?: OwnerPageProps['onDirty']}) {
  const [form, setForm] = useState(emptyForm), [issue, setIssue] = useState<string | null>(null);
  // One idempotency key per attempt: a retry after a network failure never issues a second card.
  const requestId = useRef(crypto.randomUUID());
  const mutation = useOwnerMutation();
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm);
  useOwnerDirty(dirty || mutation.busy, onDirty);
  const change = <K extends keyof GiftCardForm>(key: K, value: GiftCardForm[K]) => {setForm(current => ({...current, [key]: value})); setIssue(null); mutation.clear();};
  return <section aria-labelledby="owner-gift-card-editor"><form onSubmit={event => {event.preventDefault(); const problem = giftCardIssue(form); if (problem) {setIssue(problem); return;} mutation.run(() => send<{gift_card: GiftCard}>('/api/admin/gift-cards', {method: 'POST', body: JSON.stringify(giftCardPayload(form, requestId.current))}), result => {requestId.current = crypto.randomUUID(); onDone(result.gift_card);});}}>
    <Stack gap="md" maw={640}>
      <Title order={2} id="owner-gift-card-editor">Nueva tarjeta de regalo</Title>
      {issue ? <Alert color="red" role="alert">{issue}</Alert> : mutation.error && <OwnerError error={mutation.error}/>}
      <NumberInput label={`Monto inicial (${merchantRegion().currency})`} min={1} decimalScale={merchantRegion().minorUnits} allowNegative={false} value={form.amount_q} onChange={value => change('amount_q', value)} disabled={mutation.busy}/>
      <TextInput label="Nombre de quien la recibe (opcional)" placeholder="Juan Pérez" maxLength={120} value={form.issued_to_name} onChange={event => change('issued_to_name', event.currentTarget.value)} disabled={mutation.busy}/>
      <TextInput label="Teléfono de quien la recibe (opcional)" placeholder="55551234" type="tel" maxLength={30} value={form.issued_to_phone} onChange={event => change('issued_to_phone', event.currentTarget.value)} disabled={mutation.busy}/>
      <Group><Button type="submit" loading={mutation.busy}>Crear tarjeta</Button><Button variant="default" disabled={mutation.busy} onClick={() => {if (mayDiscard(dirty)) onCancel();}}>Cancelar</Button></Group>
    </Stack>
  </form></section>;
}

function Ledger({code, send}: {code: string; send: OwnerRequest}) {
  const [revision, setRevision] = useState(0);
  const resource = useOwnerResource<GiftCardLedger>(`/api/admin/gift-cards/${encodeURIComponent(code)}/ledger`, revision, send);
  if (resource.loading) return <OwnerLoading label="Consultando movimientos…"/>;
  if (resource.error) return <OwnerError error={resource.error} retry={() => setRevision(value => value + 1)}/>;
  if (!resource.data?.card || !resource.data.ledger) return null;
  const {card, ledger, transactions} = resource.data;
  return <Stack gap="sm" className="panel" p="md">
    <Group justify="space-between"><Title order={3}>Movimientos de {card.code}</Title><Badge variant="light" color={ledger.mismatch ? 'red' : 'green'}>{ledger.mismatch ? 'Revisar saldo' : 'Saldo consistente'}</Badge></Group>
    <SimpleGrid cols={{base: 2, sm: 4}}>
      <div><Text size="sm" c="dimmed">Saldo guardado</Text><Text fw={600}>{amount(ledger.stored_balance_q)}</Text></div>
      <div><Text size="sm" c="dimmed">Saldo esperado</Text><Text fw={600}>{amount(ledger.expected_balance_q)}</Text></div>
      <div><Text size="sm" c="dimmed">Emitido</Text><Text fw={600}>{amount(ledger.issue_total_q)}</Text></div>
      <div><Text size="sm" c="dimmed">Usado</Text><Text fw={600}>{amount(ledger.redeem_total_q)}</Text></div>
    </SimpleGrid>
    {ledger.mismatch && <Text size="sm" c="red">Diferencia de {amount(ledger.delta_q)} entre el saldo guardado y los movimientos. Revisa con soporte antes de usar esta tarjeta.</Text>}
    {!transactions.length ? <Text size="sm">Sin movimientos registrados.</Text> : <Table.ScrollContainer minWidth={480} type="native" tabIndex={0} role="region" aria-label={`Movimientos de la tarjeta ${card.code}`}><Table><Table.Thead><Table.Tr><Table.Th scope="col">Fecha</Table.Th><Table.Th scope="col">Movimiento</Table.Th><Table.Th scope="col" ta="right">Monto</Table.Th><Table.Th scope="col" ta="right">Saldo después</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{transactions.slice(0, 10).map(tx => <Table.Tr key={tx.id}><Table.Td>{ownerDateTime(tx.created_at)}</Table.Td><Table.Td>{tx.tx_type === 'ISSUE' ? 'Emisión' : tx.tx_type === 'REDEEM' ? 'Uso' : tx.tx_type}</Table.Td><Table.Td ta="right">{amount(tx.amount_q)}</Table.Td><Table.Td ta="right">{amount(tx.balance_after_q)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack>;
}

export default function OwnerGiftCards({staff, features, onDirty, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [adding, setAdding] = useState(false), [created, setCreated] = useState<GiftCard | null>(null), [selected, setSelected] = useState<string | null>(null);
  const allowed = staff.role === 'OWNER' && features.gift_cards === true;
  const resource = useOwnerResource<{gift_cards: GiftCard[]}>(allowed ? '/api/admin/gift-cards?limit=100' : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Tarjetas de regalo" owner={staff.role === 'OWNER'}/>;
  const cards = resource.data?.gift_cards ?? [];
  const refresh = () => setRevision(value => value + 1);
  return <Stack gap="xl">
    <Group justify="space-between"><div><Title order={1}>Tarjetas de regalo</Title><Text c="dimmed" mt="sm">Emite tarjetas con saldo, comparte su código y revisa que cada saldo coincida con sus movimientos. El equipo las cobra desde el escáner.</Text></div><Button onClick={() => {setAdding(true); setCreated(null);}} disabled={adding || resource.loading || !!resource.error}>Crear tarjeta</Button></Group>
    {created && <Alert color="green" role="status" title="Tarjeta creada"><Text size="sm">Código: <strong>{created.code}</strong>{created.qr_token ? <> · Token QR: <strong>{created.qr_token}</strong></> : null}</Text><Text size="sm">Saldo inicial {amount(created.initial_amount_q)} · saldo actual {amount(created.balance_q)}. Comparte el código por un medio privado.</Text></Alert>}
    {adding && <IssueForm send={send} onDirty={onDirty} onCancel={() => setAdding(false)} onDone={card => {setAdding(false); setCreated(card); setSelected(card.code); refresh();}}/>}
    {resource.loading ? <OwnerLoading label="Cargando tarjetas…"/> : resource.error ? <OwnerError error={resource.error} retry={refresh}/> : !cards.length ? <Text>Todavía no hay tarjetas de regalo. Crea la primera para regalar saldo a un cliente.</Text> : <Table.ScrollContainer minWidth={720} type="native" tabIndex={0} role="region" aria-label="Tarjetas de regalo emitidas"><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th scope="col">Emitida</Table.Th><Table.Th scope="col">Código</Table.Th><Table.Th scope="col">Para</Table.Th><Table.Th scope="col" ta="right">Saldo</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col">Acciones</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{cards.map(card => <Table.Tr key={card.id}><Table.Td>{ownerDateTime(card.created_at)}</Table.Td><Table.Td fw={600}>{card.code}</Table.Td><Table.Td>{card.issued_to_name || card.issued_to_phone || <Text size="sm" c="dimmed">Sin destinatario</Text>}</Table.Td><Table.Td ta="right">{amount(card.balance_q)}<Text size="xs" c="dimmed">inicial {amount(card.initial_amount_q)}</Text></Table.Td><Table.Td><Badge variant="light" color={!card.status || card.status === 'ACTIVE' ? 'green' : 'gray'}>{statusLabel(card.status)}</Badge></Table.Td><Table.Td><Button variant="default" size="compact-sm" aria-label={`Ver movimientos de ${card.code}`} aria-pressed={selected === card.code} onClick={() => setSelected(current => current === card.code ? null : card.code)}>{selected === card.code ? 'Ocultar movimientos' : 'Ver movimientos'}</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    {selected && <Ledger key={`${selected}:${revision}`} code={selected} send={send}/>}
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('team')}>Permisos del equipo para tarjetas</Button></Group>}
  </Stack>;
}
