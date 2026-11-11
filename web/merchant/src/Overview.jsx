import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Title,
  SimpleGrid,
  Accordion,
} from "@mantine/core";
import { LineChart } from "@mantine/charts";
import {RewardExposurePanel,StaffActivityPanel} from "./ActivationInsights.jsx";
import RedemptionReturns from "./RedemptionReturns.jsx";
import { isDemo, useResource } from "./api.js";
import { BusinessLink, Failure, Loading, Locked, number, money, periodDate } from "./ui.jsx";
function Comparison({ current, previous, rate = false }) {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    current === undefined
  )
    return (
      <Text size="xs" c="dimmed">
        Sin base comparable
      </Text>
    );
  if (!rate && previous === 0)
    return (
      <Text size="xs" c="dimmed">
        Antes: 0 · sin variación porcentual
      </Text>
    );
  const change = rate
    ? current - previous
    : ((current - previous) / previous) * 100;
  return (
    <Text size="xs" c="dimmed">
      {change > 0 ? "+" : ""}
      {number(change)}
      {rate ? " puntos porcentuales" : "%"} frente al período anterior
    </Text>
  );
}
export default function Overview({ features, onNavigate }) {
  const [days, setDays] = useState("30"),
    [branch, setBranch] = useState(""),
    [refresh, setRefresh] = useState(0);
  const branches = useResource(
    features.multi_branch ? "/api/admin/branches" : null,
    refresh,
  );
  const result = useResource(
    features.analytics
      ? `/api/admin/analytics/overview?days=${days}${branch ? `&branch_id=${encodeURIComponent(branch)}` : ""}`
      : null,
    refresh,
  );
  if (!features.analytics)
    return (
      <>
        <Title order={1}>Tu negocio, con perspectiva</Title>
        <Locked feature="Análisis de resultados" />
        <Button onClick={() => onNavigate("launch")}>
          Preparar mi programa
        </Button>
      </>
    );
  const data = result.data,
    current = data?.current,
    previous = data?.previous;
  const metrics = [
    ["recorded_sales_q", "Ventas registradas", money, false],
    ["active_customers", "Clientes con compras", number, false],
    [
      "repeat_rate_pct",
      "Clientes que repitieron",
      (value) => (value == null ? "—" : `${number(value)}%`),
      true,
    ],
    ["redemptions", "Recompensas canjeadas", number, false],
  ];
  const selectedName = branch
    ? (branches.data?.branches || []).find((b) => b.id === branch)?.name
    : "Todas las sucursales";
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Tu negocio, con perspectiva</Title>
        <Text className="intro">
          Entiende qué está pasando y decide tu próximo paso.
        </Text>
      </div>
      <Group justify="space-between" align="end" className="filters">
        <Group align="end">
          <Select
            label="Período"
            value={days}
            onChange={(value) => setDays(value || "30")}
            allowDeselect={false}
            data={[
              { value: "7", label: "Últimos 7 días" },
              { value: "30", label: "Últimos 30 días" },
              { value: "90", label: "Últimos 90 días" },
            ]}
            w={180}
          />
          <Select
            label="Sucursal"
            value={branch}
            onChange={(value) => setBranch(value || "")}
            allowDeselect={false}
            data={[
              { value: "", label: "Todas las sucursales" },
              ...(branches.data?.branches || []).map((b) => ({
                value: b.id,
                label: b.name,
              })),
            ]}
            disabled={
              !features.multi_branch || branches.loading || !!branches.error
            }
            w={240}
          />
        </Group>
        <Button
          variant="default"
          onClick={() => setRefresh((v) => v + 1)}
          disabled={result.loading}
        >
          Actualizar
        </Button>
      </Group>
      {branches.error && (
        <Alert color="yellow">
          No se pudo cargar la lista de sucursales. Puedes consultar el total
          del negocio o volver a actualizar.
        </Alert>
      )}
      {result.loading ? (
        <Loading label="Consultando resultados…" />
      ) : result.error ? (
        <Failure error={result.error} retry={() => setRefresh((v) => v + 1)} />
      ) : (
        data && (
          <>
            <div className="scope-line">
              <Text size="sm" fw={500}>
                {selectedName} · {periodDate(data.period.start, data.timezone)}–
                {periodDate(data.period.end, data.timezone)}
              </Text>
              <Text size="xs" c="dimmed">
                Actualizado{" "}
                {new Intl.DateTimeFormat("es-GT", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: data.timezone,
                }).format(new Date(data.generated_at))}{" "}
                · {data.timezone} · hoy es parcial
              </Text>
            </div>
            <SimpleGrid
              cols={{ base: 2, lg: 4 }}
              spacing={0}
              className="metric-strip"
            >
              {metrics.map(([key, label, format, rate]) => (
                <div className="metric" key={key}>
                  <Text size="sm" fw={500}>
                    {label}
                  </Text>
                  <Text className="metric-value">{format(current[key])}</Text>
                  <Comparison
                    current={current[key]}
                    previous={previous[key]}
                    rate={rate}
                  />
                  {key === "repeat_rate_pct" && (
                    <Text size="xs" mt={6}>
                      {number(current.repeat_customers)} de{" "}
                      {number(current.active_customers)} clientes compraron 2 o
                      más veces.
                    </Text>
                  )}
                </div>
              ))}
            </SimpleGrid>
            <RewardExposurePanel branchId={branch||null} refresh={refresh}/>
            <StaffActivityPanel branchId={branch||null} refresh={refresh}/>
            <RedemptionReturns branchId={branch||null} refresh={refresh}/>
            {current.purchases === 0 && (
              <Alert
                title="Todavía no hay compras en este período"
                color="gray"
              >
                Prueba otro período o sucursal. Si estás empezando, registra una
                compra real desde el escáner o conecta tu punto de venta.
              </Alert>
            )}
            <section className="chart-section" aria-labelledby="sales-title">
              <Group justify="space-between" align="start">
                <div>
                  <Title order={2} id="sales-title">
                    Cómo se mueven tus ventas
                  </Title>
                  <Text size="sm" c="dimmed">
                    {number(current.purchases)} compras registradas · ticket
                    promedio {money(current.average_ticket_q)}
                  </Text>
                </div>
                <Text size="sm" c="dimmed">
                  Moneda: {data.currency || 'GTQ'}
                </Text>
              </Group>
              <LineChart
                h={285}
                mt="xl"
                data={data.daily}
                dataKey="date"
                series={[
                  {
                    name: "recorded_sales_q",
                    label: "Ventas registradas",
                    color: "terra.6",
                  },
                ]}
                curveType="linear"
                withDots={data.daily.length <= 7}
                withLegend={false}
                valueFormatter={money}
                xAxisProps={{ tickFormatter: (date) => date.slice(5) }}
                yAxisProps={{ width: 65 }}
                lineChartProps={{
                  "aria-label":
                    "Ventas registradas por día; los mismos datos están disponibles en la tabla.",
                }}
              />
              <Accordion variant="default" mt="md">
                <Accordion.Item value="daily">
                  <Accordion.Control>
                    Ver los datos del gráfico
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Table.ScrollContainer minWidth={440}>
                      <Table captionSide="top">
                        <Table.Caption>
                          Compras y ventas registradas por fecha local
                        </Table.Caption>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Fecha</Table.Th>
                            <Table.Th ta="right">Compras</Table.Th>
                            <Table.Th ta="right">Ventas</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {data.daily.map((row) => (
                            <Table.Tr key={row.date}>
                              <Table.Td>{row.date}</Table.Td>
                              <Table.Td ta="right">
                                {number(row.purchases)}
                              </Table.Td>
                              <Table.Td ta="right">
                                {money(row.recorded_sales_q)}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </section>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
              <section>
                <Title order={2}>Recompensas más elegidas</Title>
                <Text size="sm" c="dimmed" mb="md">
                  Canjes completados en el período y la sucursal seleccionados.
                </Text>
                {data.rewards.length ? (
                  <Table.ScrollContainer minWidth={310}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Recompensa</Table.Th>
                          <Table.Th ta="right">Canjes</Table.Th>
                          <Table.Th ta="right">Puntos usados</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {data.rewards.map((reward, index) => (
                          <Table.Tr key={`${reward.name}-${index}`}>
                            <Table.Td>{reward.name}</Table.Td>
                            <Table.Td ta="right">
                              {number(reward.redemptions)}
                            </Table.Td>
                            <Table.Td ta="right">
                              {number(reward.points_redeemed)}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                ) : (
                  <Text py="lg">
                    Aún no hay canjes completados en este período.
                  </Text>
                )}
                <BusinessLink
                  href="/administracion/?seccion=recompensas"
                  mt="md"
                  display="inline-block"
                >
                  Administrar recompensas
                </BusinessLink>
              </section>
              <section className="next-step">
                <Title order={2}>Tu próximo paso</Title>
                {current.purchases === 0 ? (
                  <>
                    <Text mt="sm">
                      Pon tu programa frente a tus clientes. Prepara una
                      recompensa y muestra el QR de inscripción en caja.
                    </Text>
                    <Button mt="lg" onClick={() => onNavigate("launch")}>
                      Revisar el lanzamiento
                    </Button>
                  </>
                ) : current.redemptions === 0 ? (
                  <>
                    <Text mt="sm">
                      Hay compras, pero todavía no hay canjes en esta vista.
                      Revisa que la primera recompensa sea clara y alcanzable.
                    </Text>
                    <Button
                      mt="lg"
                      component="a"
                      href={isDemo?undefined:"/administracion/?seccion=recompensas"}
                      disabled={isDemo}
                    >
                      Revisar recompensas
                    </Button>
                  </>
                ) : (
                  <>
                    <Text mt="sm">
                      {number(current.repeat_customers)} clientes repitieron y
                      se completaron {number(current.redemptions)} canjes. Usa
                      este período como referencia antes de probar una
                      promoción.
                    </Text>
                    <Button mt="lg" onClick={() => onNavigate("campaigns")}>
                      Preparar una campaña
                    </Button>
                  </>
                )}
              </section>
            </SimpleGrid>
            <Accordion variant="default">
              <Accordion.Item value="definitions">
                <Accordion.Control>
                  Qué significan estos números
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    <Text size="sm">
                      Ventas registradas: importes de compras válidas recibidas
                      por PF, incluidas compras con puntos pendientes. Se
                      excluyen las devoluciones completas, ajustes y bonos. No
                      representan todas las ventas del negocio ni ingresos
                      causados por el programa.
                    </Text>
                    <Text size="sm">
                      Clientes que repitieron: clientes con al menos dos compras
                      dentro del período, divididos entre los clientes con
                      alguna compra. No es una medición de retención entre
                      cohortes.
                    </Text>
                    <Text size="sm">
                      Comparamos con{" "}
                      {periodDate(data.period.previous_start, data.timezone)}–
                      {periodDate(data.period.previous_end, data.timezone)},
                      hasta la misma hora local. La última fecha es parcial en
                      ambos períodos. Los datos pueden cambiar al sincronizar
                      compras o procesar devoluciones.
                    </Text>
                    <Text size="sm">
                      El ticket promedio divide las ventas registradas entre las
                      compras. Los canjes usan la fecha de entrega de la
                      recompensa. Sin costos y una comparación controlada, no
                      calculamos rentabilidad ni retorno de inversión.
                    </Text>
                    {data.notes?.map((note) => (
                      <Text size="sm" key={note}>
                        {note}
                      </Text>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </>
        )
      )}
    </Stack>
  );
}
