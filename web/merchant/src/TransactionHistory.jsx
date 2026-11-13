import { readActivityFilters, activityFiltersHref, activitySourceLabels } from './activity-drilldown.js';
import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Group, List, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { isDemo, useResource } from './api.js';
import { Failure, Loading, money } from './ui.jsx';
import {HistoricalReplay,RejectedAttempts,SafeCorrections} from './TransactionEvidence.jsx';

const base = '/api/admin/transaction-history';
// Rule rates and intermediate totals must not inherit dashboard rounding.
const number = value => value == null ? '—' : new Intl.NumberFormat(merchantRegion().locale, { maximumFractionDigits: 20 }).format(value);
const statusLabels = { POSTED:'Registrado',PENDING:'Pendiente',REVERSED:'Revertido',EXPIRED:'Vencido',REDEEMED:'Canjeado',CANCELLED:'Cancelado',CANCELED:'Cancelado',UNKNOWN:'Sin confirmar' };
const sourceLabels = { online:'Equipo en línea',offline:'Equipo sin conexión',external:'Caja o integración',order:'Pedido',redeem:'Canje',reversal:'Reversión',migration:'Importación',ledger_correction:'Corrección de saldo',other:'Otro origen' };
const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const outcomes = { applied:'Aplicada',inactive:'Inactiva',program_type:'Otro tipo de programa',weekday:'No corresponde al día',min_amount_q:'No alcanza el monto',min_visits:'No alcanza las visitas',min_items:'No alcanza los artículos',hours:'Fuera del horario' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function date(value) { return value ? new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'medium',timeStyle:'short',timeZone:merchantRegion().timezone}).format(new Date(value)) : 'Sin registrar'; }
function signed(value) { return value === null ? 'Sin confirmar' : `${value > 0 ? '+' : ''}${number(value)}`; }
function Conditions({ condition }) {
  const lines = [];
  if (condition.weekdays !== null) lines.push(condition.weekdays.length ? condition.weekdays.map(day=>days[day]).join(', ') : 'Ningún día válido');
  if (condition.min_amount_q !== null) lines.push(`Compra mínima: ${money(condition.min_amount_q)}`);
  if (condition.min_visits !== null) lines.push(`Visitas mínimas: ${number(condition.min_visits)}`);
  if (condition.min_items !== null) lines.push(`Artículos mínimos: ${number(condition.min_items)}`);
  if (condition.start_hour !== null) lines.push(`Desde la hora ${condition.start_hour}`);
  if (condition.end_hour !== null) lines.push(`Hasta la hora ${condition.end_hour}, incluida`);
  return lines.length ? <List size="sm" spacing="xs">{lines.map(line=><List.Item key={line}>{line}</List.Item>)}</List> : <Text size="sm">Sin condiciones adicionales.</Text>;
}
function Award({ award }) {
  const program = award.program, criteria = award.targeted_offer.criteria;
  return <Stack gap="md">
    <Title order={3}>Cómo se calcularon los puntos</Title>
    <Text maw="72ch">{program.type === 'SPEND' ? `${money(award.inputs.amount_q)} × ${number(program.rate)} puntos por quetzal.` : `${number(program.quantity)} ${program.type === 'VISIT' ? 'visitas' : 'artículos'} × ${number(program.rate)} puntos.`} {program.type === 'SPEND' ? `Redondeo ${program.round === 'floor' ? 'hacia abajo' : program.round === 'ceil' ? 'hacia arriba' : 'al entero más cercano'}.` : 'Se usa una unidad cuando se registra cero; la cantidad se redondea hacia abajo.'}</Text>
    <Text>Puntos base: <Text component="span" fw={600}>{number(award.base_points)}</Text>. Total del programa: <Text component="span" fw={600}>{number(award.program_points)}</Text>.</Text>
    {award.rules.filter(rule=>rule.outcome==='applied').map(rule=><Text key={rule.index}>De {number(rule.points_before)} a {number(rule.points_after)} puntos</Text>)}
    <Text size="sm" c="dimmed" maw="72ch">Las reglas se aplicaron en el orden guardado. El total del programa se redondeó hacia abajo antes de sumar una oferta dirigida.</Text>
    {award.targeted_offer.bonus_points > 0 && <Text>Bono de oferta dirigida: +{number(award.targeted_offer.bonus_points)} puntos. ID de campaña: <Text component="span" style={{overflowWrap:'anywhere'}}>{award.targeted_offer.campaign_id || 'Sin registrar'}</Text>.</Text>}
    {award.targeted_offer.bonus_points > 0 && typeof criteria === 'object' && <section>
      <Title order={3}>Condiciones guardadas de la oferta</Title>
      <Stack gap="sm" mt="sm" maw="72ch">
        <Text>Compra mínima: {money(criteria.minimum_purchase_q)}. Compra evaluada: {money(criteria.purchase.amount_q)}.</Text>
        <Text>Vigencia guardada: desde {date(criteria.starts_at)} hasta {date(criteria.expires_at)}. El final no está incluido.</Text>
        <Text>Comprobación con el reloj de la base de datos: {date(criteria.evaluated_at)}. Fechas en hora de Guatemala.</Text>
        <Text>El cliente pertenecía al grupo guardado que recibe el bono, no lo había usado y seguía activo. La campaña estaba activa, el programa estaba habilitado al solicitar los puntos y el plan permitía aplicar la oferta.</Text>
        <Text>{criteria.points_budget === null ? 'Sin límite de puntos configurado en esa evaluación.' : `Límite guardado de campaña: ${number(criteria.points_budget)} puntos.`} Comprometidos antes: {number(criteria.points_committed_before)}; después: {number(criteria.points_committed_after)}.</Text>
        <Text size="sm" c="dimmed">Estas condiciones pertenecen al momento de la compra. La selección original de la audiencia no se volvió a evaluar y los puntos comprometidos no describen la disponibilidad actual.</Text>
      </Stack>
    </section>}
    <Accordion variant="default">
      <Accordion.Item value="rules"><Accordion.Control>Ver reglas evaluadas</Accordion.Control><Accordion.Panel><Stack gap="lg">
        {award.rules.length ? award.rules.map(rule=><section key={rule.index}>
          <Group justify="space-between"><Text fw={600}>Regla {rule.index+1}: {rule.kind === 'bonus_points' ? `sumar ${number(rule.value)} puntos` : `multiplicar por ${number(rule.value)}`}</Text><Badge c="var(--mantine-color-text)" variant="light" color={rule.outcome==='applied'?'green':'gray'}>{outcomes[rule.outcome]}</Badge></Group>
          <Conditions condition={rule.condition} />
          {rule.program_type && <Text size="sm">Programa requerido: {rule.program_type === 'SPEND' ? 'compras' : rule.program_type === 'VISIT' ? 'visitas' : rule.program_type === 'ITEM' ? 'artículos' : 'otro programa'}.</Text>}
          {rule.max_points !== null && <Text size="sm">Tope después de esta regla: {number(rule.max_points)} puntos.</Text>}
        </section>) : <Text>Esta compra no tenía reglas de campaña.</Text>}
        <Text size="sm">Evaluado por el servidor: {date(award.evaluated_at)}. Zona horaria del programa: {award.time_zone}; hora evaluada: {award.local_hour}; día: {days[award.local_weekday]}.</Text>
        <Text size="xs" c="dimmed" style={{overflowWrap:'anywhere'}}>Versión de reglas: {award.rule_version}</Text>
      </Stack></Accordion.Panel></Accordion.Item>
    </Accordion>
    <Text size="sm">Espera inicial: {number(award.hold_days)} días. Estado al registrar: {statusLabels[award.initial_status]}.{award.available_at ? ` Disponibles desde: ${date(award.available_at)}.` : ''}</Text>
    {award.offline_capture && <Text size="sm">Hora informada por el dispositivo sin conexión: {date(award.offline_capture.recorded_at)}. El cálculo utilizó la hora del servidor.</Text>}
  </Stack>;
}
function Detail({ data, select, titleRef }) {
  const { movement: row, explanation } = data;
  return <Stack gap="lg">
    <Title order={2} ref={titleRef} tabIndex={-1}>Detalle del movimiento</Title>
    <Group justify="space-between" align="start"><div><Text fw={600}>{row.label} · {row.customer_name || 'Cliente sin nombre'}</Text><Text size="sm">{date(row.created_at)}</Text></div><Badge c="var(--mantine-color-text)" variant="light" color={explanation.coverage==='recorded'?'green':'gray'}>{explanation.coverage==='recorded'?'Cálculo guardado':'Información parcial'}</Badge></Group>
    <Text size="sm" style={{overflowWrap:'anywhere'}}>ID: {row.id}</Text>
    <SimpleGrid cols={{base:1,sm:3}} spacing="md">
      <div><Text size="sm" c="dimmed">Puntos del movimiento</Text><Text fw={600}>{signed(row.points)}</Text></div>
      <div><Text size="sm" c="dimmed">Estado actual</Text><Text>{statusLabels[row.status]||'Sin confirmar'}</Text></div>
      <div><Text size="sm" c="dimmed">Origen</Text><Text>{sourceLabels[row.source]||'Otro origen'}</Text></div>
    </SimpleGrid>
    <Text size="sm">Registró: {row.staff_name || 'Sin persona registrada'}. Sucursal: {row.branch_name || 'Sin sucursal registrada'}.</Text>
    {row.kind==='purchase' && <Text>Compra registrada: {money(row.amount_q)}. Visitas: {number(row.visits)}. Artículos: {number(row.items)}.</Text>}
    {row.redemption && <Text>Recompensa: {row.redemption.reward_name || 'Sin nombre disponible'}. Costo guardado: {number(row.redemption.points_cost)} puntos.</Text>}
    {explanation.award && <Award award={explanation.award} />}
    <HistoricalReplay replay={explanation.replay} history={data.history}/>
    {row.adjustment && <List spacing="xs"><List.Item>Puntos disponibles: {signed(row.adjustment.points)}</List.Item><List.Item>Puntos pendientes: {signed(row.adjustment.pending_points)}</List.Item><List.Item>Puntos acumulados: {signed(row.adjustment.lifetime_points)}</List.Item></List>}
    <section><Title order={3}>Qué permite confirmar este registro</Title><List mt="sm" spacing="sm" maw="72ch">{explanation.limitations.map((line,index)=><List.Item key={index}>{line}</List.Item>)}</List></section>
    <Group>{row.links.original_id && <Button mih={44} variant="outline" onClick={()=>select(row.links.original_id)}>Ver movimiento original</Button>}{row.links.reversal_id && <Button mih={44} variant="outline" onClick={()=>select(row.links.reversal_id)}>Ver reversión relacionada</Button>}</Group>
    <SafeCorrections customerId={row.customer_id}/>
  </Stack>;
}
export default function TransactionHistory() {
  const [version,setVersion]=useState(0),[kind,setKind]=useState('all'),[pages,setPages]=useState([]),[selected,setSelected]=useState(null),[search,setSearch]=useState(''),[searchError,setSearchError]=useState('');
  const titleRef=useRef(null);
  const [activityFilters,setActivityFilters]=useState(()=>readActivityFilters(location.search));
  const cursor=pages.at(-1),params=new URLSearchParams({kind,limit:'25'});
  if(cursor)params.set('cursor',cursor);
  for(const [key,value] of Object.entries(activityFilters))params.set(key,value);
  const history=useResource(selected?null:`${base}?${params}`,version),detail=useResource(selected?`${base}/${encodeURIComponent(selected)}`:null,version);
  useEffect(()=>{if(detail.data?.movement)titleRef.current?.focus();},[detail.data]);
  const refresh=()=>setVersion(value=>value+1);
  const updateFilters=next=>{setActivityFilters(next);setPages([]);window.history.replaceState(null,'',activityFiltersHref(next));};
  const clearFilters=()=>updateFilters({});
  const select=id=>{setSelected(id);setSearch(id);setSearchError('');};
  const close=()=>{setSelected(null);setSearch('');setSearchError('');};
  const submit=event=>{event.preventDefault();const id=search.trim();if(!uuid.test(id)){setSearchError('Ingresa el ID completo del movimiento.');return;}select(id);refresh();};
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Movimientos y puntos</Title><Text mt="sm" c="dimmed" maw="72ch">Revisa una compra, un canje o un cambio de saldo. Cada detalle distingue lo que quedó guardado de lo que todavía no se puede confirmar.</Text></div><Button mih={44} variant="outline" onClick={refresh} loading={history.loading||detail.loading}>Actualizar historial</Button></Group>
    {isDemo && <Text size="sm" c="dimmed">Movimientos ficticios para explorar el historial. No representan clientes ni puntos reales.</Text>}
    {!selected&&<RejectedAttempts/>}
    {Object.keys(activityFilters).length > 0 && <Alert color="gray" title="Vista filtrada desde el resumen"><Stack gap="sm"><Text size="sm">{activityFilters.staff_id ? 'Persona seleccionada. ' : ''}{activityFilters.source_group ? `${activitySourceLabels[activityFilters.source_group]}. ` : ''}{activityFilters.branch_id ? 'Sucursal seleccionada. ' : ''}{activityFilters.start ? `Desde ${date(activityFilters.start)} hasta ${date(activityFilters.end)}, sin incluir el final.` : ''}</Text><Button variant="default" mih={44} w="fit-content" onClick={clearFilters}>Quitar filtros del resumen</Button></Stack></Alert>}
    <form onSubmit={submit}><Group align="end"><TextInput size="md" label="ID del movimiento" description="Pega el ID completo de una compra, canje o ajuste, aunque sea antiguo." placeholder="00000000-0000-0000-0000-000000000000" value={search} onChange={event=>{setSearch(event.currentTarget.value);setSearchError('');}} error={searchError} style={{flex:'1 1 300px'}}/><Button mih={44} type="submit" disabled={!search.trim()}>Buscar movimiento</Button></Group></form>
    {selected ? <section className="operation-section" aria-label="Explicación del movimiento"><Stack gap="lg">
      <Button mih={44} variant="subtle" onClick={close} w="fit-content">Volver al historial</Button>
      {detail.loading?<Loading label="Consultando el movimiento…"/>:detail.error?.status===404?<Alert title="Movimiento no encontrado" color="gray" role="status">No se encontró ese movimiento en este negocio.</Alert>:detail.error?<Failure error={detail.error} retry={refresh}/>:detail.data?.movement && detail.data?.explanation?<Detail data={detail.data} select={select} titleRef={titleRef}/>:<Failure error={new Error('Respuesta incompleta')} retry={refresh}/>}
    </Stack></section> : <Stack gap="lg">
      <Select size="md" label="Tipo de movimiento" value={kind} allowDeselect={false} onChange={value=>{setKind(value||'all');setPages([]);}} maw={320} data={[{value:'all',label:'Todos los movimientos'},{value:'purchase',label:'Compras'},{value:'redemption',label:'Canjes'},{value:'refund',label:'Reversiones'},{value:'opening_balance',label:'Saldos iniciales'},{value:'adjustment',label:'Ajustes de saldo'},{value:'other',label:'Otros movimientos'}]}/>
      <Select size="md" label="Origen de la actividad" value={activityFilters.source_group||'all'} allowDeselect={false} onChange={value=>{const next={...activityFilters};delete next.staff_id;if(!value||value==='all')delete next.source_group;else next.source_group=value;updateFilters(next);}} maw={320} data={[{value:'all',label:'Todos los orígenes'},...Object.entries(activitySourceLabels).map(([value,label])=>({value,label}))]}/>
      {history.loading?<Loading label="Cargando movimientos…"/>:history.error?<Failure error={history.error} retry={refresh}/>:!Array.isArray(history.data?.movements)?<Failure error={new Error('Respuesta incompleta')} retry={refresh}/>:<>
        {!history.data.movements.length?<div><Text fw={600}>No hay movimientos en esta vista.</Text><Text mt="xs" size="sm">Prueba otro tipo de movimiento o busca por su ID. Las compras aparecerán cuando se registren en PF.</Text></div> : <><Stack hiddenFrom="sm" gap="lg">{history.data.movements.map(row=><article key={`${row.record}:${row.id}`} className="operation-section">
          <Group justify="space-between" align="start"><div><Text fw={600}>{row.label}</Text><Text size="sm">{row.customer_name||'Cliente sin nombre'}</Text></div><Text fw={600} style={{fontVariantNumeric:'tabular-nums'}}>{signed(row.points)} puntos</Text></Group>
          <Text size="sm" c="dimmed" mt="xs">{date(row.created_at)}</Text>
          <Group justify="space-between" mt="sm"><Text size="sm">{statusLabels[row.status]||'Sin confirmar'}</Text><Button mih={44} variant="outline" onClick={()=>select(row.id)} aria-label={`Explicar ${row.label} de ${row.customer_name||'cliente sin nombre'} del ${date(row.created_at)}`}>Explicar</Button></Group>
        </article>)}</Stack><Table.ScrollContainer visibleFrom="sm" minWidth={720} type="native" tabIndex={0} role="region" aria-label="Historial de movimientos"><Table verticalSpacing="md">
          <Table.Caption>Actividad del negocio, de la más reciente a la más antigua. Fechas en {merchantRegion().timezone}.</Table.Caption>
          <Table.Thead><Table.Tr><Table.Th scope="col">Fecha y cliente</Table.Th><Table.Th scope="col">Movimiento</Table.Th><Table.Th scope="col" ta="right">Puntos</Table.Th><Table.Th scope="col">Estado</Table.Th><Table.Th scope="col">Detalle</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{history.data.movements.map(row=><Table.Tr key={`${row.record}:${row.id}`}><Table.Td><Text size="sm" fw={500}>{row.customer_name||'Cliente sin nombre'}</Text><Text size="sm" c="dimmed">{date(row.created_at)}</Text></Table.Td><Table.Td>{row.label}</Table.Td><Table.Td ta="right" style={{fontVariantNumeric:'tabular-nums'}}>{signed(row.points)}</Table.Td><Table.Td>{statusLabels[row.status]||'Sin confirmar'}</Table.Td><Table.Td><Button mih={44} variant="subtle" onClick={()=>select(row.id)} aria-label={`Explicar ${row.label} de ${row.customer_name||'cliente sin nombre'} del ${date(row.created_at)}`}>Explicar</Button></Table.Td></Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer></>}
        <Group justify="space-between"><Button mih={44} variant="default" disabled={!pages.length} onClick={()=>setPages(value=>value.slice(0,-1))}>Más recientes</Button><Text size="sm" c="dimmed">Página {pages.length+1}</Text><Button mih={44} variant="default" disabled={!history.data.next_cursor} onClick={()=>setPages(value=>[...value,history.data.next_cursor])}>Más antiguos</Button></Group>
      </>}
    </Stack>}
  </Stack>;
}
