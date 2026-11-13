import {merchantRegion} from './region.js';
import DataHealth from './DataHealth.jsx';
import { useState } from 'react';
import { Accordion, Anchor, Badge, Button, Group, List, Stack, Table, Text, Title } from '@mantine/core';
import { useResource } from './api.js';
import { BusinessLink, Failure, Loading, number } from './ui.jsx';

const status = {
  needs_attention: ['Requiere atención', 'red'], configured: ['Configurado', 'blue'],
  healthy: ['Costos completos', 'green'], not_configured: ['Sin configurar', 'gray'],
  not_in_plan: ['No incluido', 'gray'], unknown: ['Por confirmar', 'gray']
};
function date(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Sin actividad registrada';
  return new Intl.DateTimeFormat(merchantRegion().locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: merchantRegion().timezone }).format(new Date(value));
}
function metricValue(metric) {
  if (metric.key === 'cost_coverage_pct' && metric.value == null) return 'Sin canjes para evaluar';
  return typeof metric.value === 'number' ? number(metric.value) : metric.value && metric.key.endsWith('_at') ? date(metric.value) : metric.value ?? '—';
}
function ActionLink({ action }) {
  return action.href.startsWith('#')
    ? <Anchor href={action.href} py={6} display="inline-block">{action.label}</Anchor>
    : <BusinessLink href={action.href}>{action.label}</BusinessLink>;
}
function RecordedMetrics({ section }) {
  const sources = section.sources ?? [];
  return <Table.ScrollContainer minWidth={sources.length ? 540 : 0} type="native" tabIndex={sources.length ? 0 : undefined} role={sources.length ? "region" : undefined} aria-label={sources.length ? `Registros de ${section.title}` : undefined}>
    <Table maw={850}>
      <Table.Caption>{sources.length ? "Los retrasos son parte de las colas, no mensajes adicionales." : "Información registrada en PF para este negocio."}</Table.Caption>
      {sources.length > 0 && <Table.Thead><Table.Tr>
        <Table.Th scope="col">Estado</Table.Th><Table.Th scope="col" ta="right">Total</Table.Th>
        {sources.map(source => <Table.Th scope="col" key={source.id} ta="right">{source.title}</Table.Th>)}
      </Table.Tr></Table.Thead>}
      <Table.Tbody>{section.metrics.map(metric => <Table.Tr key={metric.key}>
        <Table.Th scope="row" fw={500}>{metric.label}</Table.Th>
        <Table.Td ta="right">{metricValue(metric)}</Table.Td>
        {sources.map(source => <Table.Td key={source.id} ta="right">{metricValue(source.metrics.find(value => value.key === metric.key) ?? { value: null })}</Table.Td>)}
      </Table.Tr>)}</Table.Tbody>
    </Table>
  </Table.ScrollContainer>;
}
export default function Operations() {
  const [version, setVersion] = useState(0), resource = useResource('/api/admin/operations-health', version);
  const refresh = () => setVersion(value => value + 1);
  const data = resource.data;
  const sections = data?.sections ?? [], actions = data?.next_actions ?? [];
  const attention = data?.summary?.attention_count ?? sections.filter(section => section.state === 'needs_attention').length;
  return <Stack gap="xl">
    <Group justify="space-between" align="start">
      <div><Title order={1}>Estado de la operación</Title>
        <Text c="dimmed" mt="sm" maw={740}>Revisa los pendientes de tu negocio y abre el lugar donde puedes atenderlos. Este panel consulta los registros de PF.</Text>
      </div>
      <Button variant="outline" onClick={refresh} loading={resource.loading}>Actualizar estado</Button>
    </Group>
    <DataHealth/>
    {resource.loading ? <Loading label="Consultando la operación…" /> : resource.error ? <Failure error={resource.error} retry={refresh} /> : <Stack gap="xl">
      {sections.length === 0 ? <Text>No hay áreas de operación disponibles para evaluar.</Text> : <>
        <section aria-labelledby="operation-actions" className="operation-section">
          <Title order={2} id="operation-actions">Qué revisar primero</Title>
          <Text mt="sm" maw={740}>{attention > 0
            ? `${number(attention)} ${attention === 1 ? 'área requiere' : 'áreas requieren'} atención. Una misma área puede tener varios pendientes.`
            : sections.some(section => ['not_configured', 'unknown'].includes(section.state))
              ? 'Revisa las áreas por configurar o confirmar antes de interpretar este panel.'
              : 'Sin incidencias registradas.'}</Text>
          {actions.length > 0 ? <List type="ordered" spacing="md" mt="md" maw={850}>
            {actions.map(action => <List.Item key={action.id}>
              <ActionLink action={action} /><Text size="sm" c="dimmed">{action.reason}</Text>
            </List.Item>)}
          </List> : <Text size="sm" c="dimmed" mt="sm">Comprueba también la experiencia del cliente en tu piloto. Los registros disponibles no acreditan una conexión o entrega actual.</Text>}
        </section>
        <Text size="sm" c="dimmed" maw={740}>Configurado significa que la configuración local está habilitada. No confirma conexión, entrega de mensajes ni instalación de tarjetas. Cada área indica qué evidencia está disponible.</Text>
        {sections.map(section => {
          const [label, color] = status[section.state] || status.unknown;
          return <section key={section.id} aria-labelledby={`operation-${section.id}`} className="operation-section">
            <Group justify="space-between" align="start"><Title order={2} id={`operation-${section.id}`} maw={740}>{section.title}</Title><Badge color={color} variant="light">{label}</Badge></Group>
            <Text mt="sm" maw={740}>{section.summary}</Text>
            {section.reasons?.length > 0 && <List mt="md" spacing="xs" maw={740}>
              {section.reasons.map(reason => <List.Item key={reason.code}><Text size="sm" component="span">{reason.label}{reason.count !== undefined && <Text component="span" fw={600}> ({number(reason.count)})</Text>}</Text></List.Item>)}
            </List>}
            {section.metrics?.length > 0 && <Accordion variant="default" mt="md">
              <Accordion.Item value={section.id}><Accordion.Control>Ver registros de {section.title}</Accordion.Control><Accordion.Panel><RecordedMetrics section={section} /></Accordion.Panel></Accordion.Item>
            </Accordion>}
            <Group mt="md" justify="space-between"><Text size="sm" c="dimmed">Última actividad: {date(section.last_observed_at)}</Text>{section.action && <ActionLink action={section.action} />}</Group>
          </section>;
        })}
      </>}
      <Text size="sm" c="dimmed">Consultado: {date(data?.generated_at)}. Los mensajes aceptados por un proveedor no confirman entrega al teléfono.</Text>
    </Stack>}
  </Stack>;
}
