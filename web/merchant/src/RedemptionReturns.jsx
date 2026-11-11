import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Button, Group, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { isDemo, useResource } from './api.js';
import { Failure, Loading, number, periodDate } from './ui.jsx';

export default function RedemptionReturns({ branchId = null, refresh = 0 }) {
  const heading = useRef(null);
  const [days, setDays] = useState('90');
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const connected = () => setOnline(true), disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  const result = useResource(`/api/admin/analytics/redemption-returns?days=${days}${branchId ? `&branch_id=${encodeURIComponent(branchId)}` : ''}`, `${refresh}:${retry}`);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (result.loading || url.searchParams.get('ver') !== 'visitas-tras-canje') return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
    url.searchParams.delete('ver');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [result.loading]);
  const data = result.data;
  const complete = data?.cohort && data?.completed && data?.ongoing;
  const reload = () => setRetry(value => value + 1);
  return <section className="operation-section" aria-labelledby="redemption-returns-heading">
    <Stack gap="lg">
      <div>
        <Title ref={heading} tabIndex={-1} style={{ scrollMarginTop: '8rem' }} order={2} id="redemption-returns-heading">Visitas después de canjear</Title>
        <Text size="sm" mt="xs" c="dimmed" maw="72ch">Cuántos clientes registraron otra compra durante los 30 días siguientes a un canje.</Text>
      </div>
      <Group justify="space-between" align="end">
        <Select label="Canjes del período" description="Ventana propia de este informe" value={days} onChange={value => setDays(value || '90')} allowDeselect={false} w={230} maw="100%" styles={{ input: { minHeight: 44 } }} data={[
          { value: '90', label: 'Últimos 90 días' },
          { value: '30', label: 'Últimos 30 días' },
          { value: '7', label: 'Últimos 7 días' }
        ]} />
        <Button variant="default" mih={44} disabled={result.loading || !online} onClick={reload}>Actualizar seguimiento</Button>
      </Group>
      {isDemo && <Text size="sm" c="dimmed">Ejemplo ficticio para explorar. No representa visitas ni resultados de un negocio real.</Text>}
      {!online && <Alert color="yellow" title="Sin conexión" role="alert">{data ? 'El informe conserva la última consulta y puede estar desactualizado. Vuelve a actualizar cuando recuperes la conexión.' : 'Conéctate para consultar este informe. No hay resultados disponibles sin conexión.'}</Alert>}
      {result.loading ? <Loading label="Consultando visitas posteriores…" /> : result.error || !complete ? <Failure error={result.error} retry={online ? reload : undefined} /> : <>
        <div>
          <Text size="sm" fw={500}>{branchId ? 'Sucursal seleccionada · canjes y compras posteriores' : 'Todas las sucursales · canjes y compras posteriores'}</Text>
          <Text size="sm" mt={4}>Canjes del {periodDate(data.cohort.start, data.timezone)} al {periodDate(data.cohort.end, data.timezone)} · {number(data.cohort.customers)} clientes.</Text>
          <Text size="xs" c="dimmed" mt={4}>Consultado {new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: data.timezone }).format(new Date(data.generated_at))} · {data.timezone} · hoy es parcial.</Text>
        </div>
        {data.cohort.customers === 0 ? <div>
          <Text fw={600}>Aún no hay canjes válidos en este período.</Text>
          <Text size="sm" mt="xs" c="dimmed">Prueba un período más amplio o revisa otra sucursal. El seguimiento empieza cuando se completa un canje válido.</Text>
        </div> : <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
          <div>
            <Title order={3} fz="md">Con 30 días completos</Title>
            {data.completed.customers > 0 ? <>
              <Text fz="xl" fw={600} mt="sm">{number(data.completed.return_rate_pct)}%</Text>
              <Text mt={4}>{number(data.completed.returned_customers)} de {number(data.completed.customers)} clientes volvieron a comprar.</Text>
              <Text size="sm" c="dimmed" mt="xs">{number(data.completed.without_return_customers)} sin otra compra registrada dentro de los 30 días. Todos cuentan en el porcentaje.</Text>
            </> : <Text size="sm" mt="sm">Todavía no hay clientes con 30 días completos de seguimiento.{days !== '90' ? ' Elige 90 días para consultar canjes anteriores.' : ' Los canjes de este grupo todavía son recientes.'}</Text>}
          </div>
          <div>
            <Title order={3} fz="md">Aún en seguimiento</Title>
            {data.ongoing.customers > 0 ? <>
              <Text mt="sm">{number(data.ongoing.returned_customers)} de {number(data.ongoing.customers)} ya registraron otra compra.</Text>
              <Text size="sm" c="dimmed" mt="xs">Todavía no transcurren sus 30 días. Se muestran aparte y no entran en el porcentaje de seguimiento completo.</Text>
            </> : <Text size="sm" mt="sm" c="dimmed">Todos los clientes de este período ya completaron sus 30 días de seguimiento.</Text>}
          </div>
        </SimpleGrid>}
        <Text size="sm" c="dimmed" maw="72ch">Solo incluye compras registradas en PF. Las sincronizaciones tardías, devoluciones y correcciones pueden cambiar estos resultados.</Text>
        <Accordion variant="default">
          <Accordion.Item value="definition">
            <Accordion.Control mih={44}>Cómo se cuenta una visita posterior</Accordion.Control>
            <Accordion.Panel><Stack gap="sm" maw="72ch">
              <Text size="sm">Cada cliente entra una sola vez, con su primer canje válido dentro del período elegido. No necesariamente es su primer canje histórico; un segundo canje dentro del período no reinicia el seguimiento.</Text>
              <Text size="sm">La compra debe ocurrir en una fecha local posterior al canje y antes de que transcurran 30 días exactos (720 horas). Otra compra el mismo día no cuenta.</Text>
              <Text size="sm">Se incluyen compras con puntos pendientes o posteriormente vencidos: el vencimiento de puntos no anula una compra. Se excluyen devoluciones completas, bonos, ajustes y saldos iniciales importados, además de canjes cancelados, restituidos, corregidos o con devoluciones registradas. Una autorización pendiente de caja aún no cuenta como canje completado.</Text>
              <Text size="sm">La sucursal elegida se aplica tanto al canje como a la compra posterior. Los registros sin sucursal solo aparecen al consultar todas las sucursales. Los clientes eliminados permanecen en estos totales sin datos personales.</Text>
              {data.cohort.legacy_timestamp_customers > 0 && <Text size="sm">{number(data.cohort.legacy_timestamp_customers)} clientes entran por canjes antiguos sin fecha de entrega; se usa la fecha de creación del registro.</Text>}
              <Text size="sm">Este informe muestra una asociación después del canje. No demuestra que la recompensa causó la visita, ni calcula ingresos incrementales o retorno de inversión.</Text>
            </Stack></Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </>}
    </Stack>
  </section>;
}
