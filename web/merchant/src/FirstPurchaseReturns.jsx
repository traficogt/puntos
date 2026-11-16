import { useEffect, useState } from 'react';
import { Accordion, Alert, Button, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { Select } from './inputs';
import { isDemo, useResource } from './api.js';
import { Failure, Loading, number } from './ui.jsx';

const weekLabel = value => new Intl.DateTimeFormat('es-GT', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
}).format(new Date(`${value}T12:00:00Z`));

export default function FirstPurchaseReturns({ branchId = null, refresh = 0 }) {
  const [week, setWeek] = useState('');
  const [weeks, setWeeks] = useState([]);
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const connected = () => setOnline(true), disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  const params = new URLSearchParams();
  if (week) params.set('week_start', week);
  if (branchId) params.set('branch_id', branchId);
  const result = useResource(`/api/admin/analytics/first-purchase-returns?${params}`, `${refresh}:${retry}`);
  const data = result.data;
  const complete = data?.cohort && data?.completed && data?.ongoing;
  useEffect(() => { if (data?.available_weeks) setWeeks(data.available_weeks); }, [data]);
  const reload = () => setRetry(value => value + 1);
  return <section className="operation-section" aria-labelledby="first-purchase-returns-heading">
    <Stack gap="lg">
      <div>
        <Title order={2} id="first-purchase-returns-heading">De la primera compra a la segunda</Title>
        <Text size="sm" c="dimmed" mt="xs" maw="72ch">Elige una semana y consulta cuántos clientes volvieron a comprar dentro de 30 días de su primera compra registrada en PF.</Text>
      </div>
      <Group justify="space-between" align="end">
        <Select label="Semana de la primera compra" description="De lunes a domingo; independiente del período del resumen" value={week} onChange={value => setWeek(value || '')} allowDeselect={false} disabled={!online} w={340} maw="100%" styles={{ input: { minHeight: 44 } }} data={[
          { value: '', label: 'Semana anterior completa' },
          ...weeks.map(value => ({ value, label: `Desde el ${weekLabel(value)}` }))
        ]} />
        <Button variant="default" mih={44} disabled={result.loading || !online} onClick={reload}>Actualizar primeras compras</Button>
      </Group>
      {isDemo && <Text size="sm" c="dimmed">Ejemplo ficticio. No representa clientes ni resultados de un negocio real.</Text>}
      {!online && <Alert color="yellow" title="Sin conexión" role="alert">{data ? 'Se conserva la última consulta; puede estar desactualizada. Actualiza al recuperar la conexión.' : 'Conéctate para consultar las primeras compras.'}</Alert>}
      {result.loading ? <Loading label="Consultando primeras compras…" /> : result.error || !complete ? <Failure error={result.error} retry={online ? reload : undefined} /> : <>
        <div>
          <Text fw={600}>{number(data.cohort.customers)} clientes con su primera compra registrada</Text>
          <Text size="sm" mt={4}>Del {weekLabel(data.cohort.week_start)} al {weekLabel(data.cohort.week_end)}.</Text>
          <Text size="sm" mt={4}>{branchId ? 'Primera compra en la sucursal seleccionada; regreso en cualquier sucursal del negocio.' : 'Primera compra y regreso en cualquier sucursal del negocio.'}</Text>
          <Text size="xs" c="dimmed" mt="xs">Consultado {new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: data.timezone }).format(new Date(data.generated_at))} · {data.timezone}. La semana en curso es parcial.</Text>
        </div>
        {data.data_readiness?.inactivity_allowed === false && <Alert color="yellow" title="Datos incompletos" role="alert">{data.data_readiness.summary} Una compra que todavía no se ha sincronizado puede cambiar este seguimiento.</Alert>}
        {data.cohort.customers === 0 ? <div>
          <Text fw={600}>No hay primeras compras registradas en esta semana.</Text>
          <Text size="sm" mt="xs" c="dimmed">Elige otra semana o sucursal. Las compras de clientes que ya habían comprado antes no vuelven a contarse como primeras.</Text>
        </div> : <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
          <div>
            <Title order={3} fz="md">Con 30 días completos</Title>
            {data.completed.customers > 0 ? <>
              <Text mt="sm" fw={600}>{number(data.completed.returned_customers)} de {number(data.completed.customers)} volvieron a comprar ({number(data.completed.return_rate_pct)}%).</Text>
              <Text size="sm" mt="xs" c="dimmed">{number(data.completed.without_return_customers)} sin otra compra registrada en ese plazo. También cuentan en el porcentaje.</Text>
            </> : <Text size="sm" mt="sm">Todavía no hay clientes con 30 días completos. Elige una semana anterior para ver un seguimiento terminado.</Text>}
          </div>
          <div>
            <Title order={3} fz="md">Aún en seguimiento</Title>
            {data.ongoing.customers > 0 ? <>
              <Text mt="sm">{number(data.ongoing.returned_customers)} de {number(data.ongoing.customers)} ya registraron otra compra.</Text>
              <Text size="sm" mt="xs" c="dimmed">Todavía no terminan sus 30 días. Estos clientes no entran en el porcentaje de seguimiento completo.</Text>
            </> : <Text size="sm" mt="sm" c="dimmed">Todos los clientes de esta semana completaron sus 30 días de seguimiento.</Text>}
          </div>
        </SimpleGrid>}
        <Text size="sm" c="dimmed" maw="72ch">PF solo conoce las compras que se registran aquí. La primera compra registrada puede no ser la primera visita real al negocio.</Text>
        <Accordion variant="default">
          <Accordion.Item value="definition">
            <Accordion.Control mih={44}>Cómo se cuentan las primeras compras y los regresos</Accordion.Control>
            <Accordion.Panel><Stack gap="sm" maw="72ch">
              <Text size="sm">Cada cliente entra una sola vez, en la semana de su primera compra válida de todo el historial del negocio disponible en PF. Un cambio de sucursal no lo convierte en cliente nuevo. Los clientes eliminados permanecen en estos totales sin datos personales.</Text>
              <Text size="sm">El regreso debe ocurrir en otra fecha local y antes de que transcurran 30 días exactos (720 horas) desde la primera compra. Varios recibos el mismo día no cuentan como un regreso.</Text>
              <Text size="sm">Se excluyen bonos, ajustes, saldos iniciales importados y compras completamente devueltas. Una compra con puntos pendientes o posteriormente vencidos sí cuenta.</Text>
              {data.cohort.legacy_timestamp_customers > 0 && <Text size="sm">En {number(data.cohort.legacy_timestamp_customers)} primeras compras antiguas no consta la fecha original de compra; se usa la fecha del registro.</Text>}
              <Text size="sm">Las sincronizaciones tardías, devoluciones y correcciones pueden cambiar la primera compra y estos resultados. No prueban que el programa causó el regreso ni calculan ingresos incrementales.</Text>
            </Stack></Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </>}
    </Stack>
  </section>;
}
