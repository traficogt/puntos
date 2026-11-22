import { Select } from './inputs';
import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Stack,
  Table,
  Text,
  Title,
  SimpleGrid,
  Accordion,
  TextInput,
  Textarea,
} from "@mantine/core";
import { LineChart } from "@mantine/charts";
import {RewardExposurePanel,StaffActivityPanel} from "./ActivationInsights.jsx";
import RedemptionReturns from "./RedemptionReturns.jsx";
import FirstPurchaseReturns from "./FirstPurchaseReturns.jsx";
import { api, isDemo, useResource } from "./api.js";
import { BusinessLink, Failure, Loading, Locked, number, money, periodDate } from "./ui.jsx";
import { launchReadiness } from "./launch-model.js";
import { merchantApi } from "./typed-api";
import { programPresets } from "./program-presets.js";
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
// Guided onboarding on the Home card: when the program isn't set up yet, offer
// one-click business-type presets that leave a working program ready; once set
// up, confirm and point to the next useful move. Reuses the Launch readiness
// signals (program + rewards). Collapses on the full dashboard when complete.
function GuidedStart({ features, onNavigate, hideWhenComplete = false }) {
  const [refresh, setRefresh] = useState(0);
  const [applying, setApplying] = useState(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(null);
  const [concierge, setConcierge] = useState({ open: false, sending: false, sent: false, error: "", phone: "", type: "", time: "", note: "" });
  const program = useResource("/api/admin/launch/program", refresh);
  const rewards = useResource("/api/admin/reward-workspace", refresh);
  if (program.loading || rewards.loading || program.error || rewards.error) return null;
  const readiness = launchReadiness({
    program: program.data?.program,
    rewards: rewards.data?.rewards,
    branches: rewards.data?.branches,
  });
  const needsRewards = readiness.requiresRewards !== false;
  const programReady = readiness.program === true;
  const complete = programReady && (!needsRewards || (readiness.activeRewards ?? 0) > 0);

  async function applyPreset(preset) {
    if (isDemo) { onNavigate("launch"); return; }
    setApplying(preset.key); setError("");
    try {
      const current = await api("/api/admin/launch/program");
      await merchantApi.put("/api/admin/launch/program", { ...preset.program, version: current.program.version });
      for (const reward of preset.rewards || []) {
        await api("/api/admin/reward-workspace", { method: "POST", body: JSON.stringify({
          requestId: crypto.randomUUID(),
          reward: { name: reward.name, description: reward.description ?? null, points_cost: reward.points_cost, active: true, stock: null, valid_until: null, branch_ids: [] },
          available: true,
        }) });
      }
      setApplied(preset); setRefresh((value) => value + 1);
    } catch (e) {
      if (e.name !== "AbortError")
        setError(e.status === 409
          ? "Otra sesión cambió la configuración. Recarga la página e inténtalo de nuevo."
          : e.message || "No se pudo preparar el programa. Inténtalo de nuevo.");
    } finally { setApplying(null); }
  }

  // Done-for-you onboarding ("exit #2"): the owner asks PuntosFieles to set the program up for them.
  async function submitConcierge() {
    if (isDemo) return;
    if (concierge.phone.trim().length < 7) {
      setConcierge((c) => ({ ...c, error: "Escribe un teléfono o WhatsApp donde podamos contactarte." }));
      return;
    }
    setConcierge((c) => ({ ...c, sending: true, error: "" }));
    try {
      await api("/api/admin/concierge-request", { method: "POST", body: JSON.stringify({
        phone: concierge.phone.trim(),
        business_type: concierge.type || "Otro",
        preferred_time: concierge.time.trim(),
        note: concierge.note.trim(),
      }) });
      setConcierge((c) => ({ ...c, sending: false, sent: true }));
    } catch (e) {
      if (e.name !== "AbortError")
        setConcierge((c) => ({ ...c, sending: false, error: e.message || "No se pudo enviar la solicitud. Inténtalo de nuevo." }));
    }
  }

  // Offered at every incomplete step of setup, not only when choosing a preset.
  const conciergeExit = !isDemo && (concierge.sent ? (
          <Alert color="teal" title="¡Gracias! Te contactaremos pronto">
            Dejaremos tu programa funcionando contigo. Mientras tanto puedes seguir configurando por tu cuenta y ajustarlo después.
          </Alert>
        ) : !concierge.open ? (
          <Button variant="subtle" w="fit-content" onClick={() => setConcierge((c) => ({ ...c, open: true }))}>
            Prefiero que PuntosFieles lo configure por mí
          </Button>
        ) : (
          <Stack gap="sm" className="panel" p="md">
            <Title order={3}>Lo configuramos contigo</Title>
            <Text size="sm">Cuéntanos cómo contactarte y dejamos tu programa listo para operar.</Text>
            {concierge.error && <Alert color="red" role="alert">{concierge.error}</Alert>}
            <TextInput label="Teléfono o WhatsApp" required maxLength={25} value={concierge.phone} onChange={(e) => setConcierge((c) => ({ ...c, phone: e.currentTarget.value }))} />
            <Select
              label="Tipo de negocio"
              value={concierge.type}
              onChange={(value) => setConcierge((c) => ({ ...c, type: value || "" }))}
              allowDeselect={false}
              data={Array.from(new Set([...programPresets.map((p) => p.label), "Otro"])).map((label) => ({ value: label, label }))}
            />
            <TextInput label="Horario preferido para contactarte (opcional)" maxLength={120} value={concierge.time} onChange={(e) => setConcierge((c) => ({ ...c, time: e.currentTarget.value }))} />
            <Textarea label="¿Algo que debamos saber? (opcional)" maxLength={1000} autosize minRows={2} value={concierge.note} onChange={(e) => setConcierge((c) => ({ ...c, note: e.currentTarget.value }))} />
            <Group>
              <Button loading={concierge.sending} onClick={submitConcierge}>Enviar solicitud</Button>
              <Button variant="default" onClick={() => setConcierge((c) => ({ ...c, open: false, error: "" }))}>Cancelar</Button>
            </Group>
          </Stack>
  ));

  if (applied)
    return (
      <Stack className="panel" gap="sm" p="md">
        <Title order={2}>¡Listo! Tu programa quedó configurado</Title>
        <Text>{applied.label}: {applied.summary} Ya puedes registrar clientes.</Text>
        <Group>
          <Button onClick={() => onNavigate("brand")}>Compartir mi QR de registro</Button>
          <Button variant="default" onClick={() => onNavigate("launch")}>Ajustar mi programa</Button>
        </Group>
      </Stack>
    );

  if (complete && hideWhenComplete) return null;

  if (complete)
    return (
      <Stack className="panel" gap="sm" p="md">
        <Title order={2}>Tu programa está activo</Title>
        <Text>Ahora haz que tus clientes vuelvan: activa una notificación en su billetera o comparte tu QR de registro.</Text>
        <Group>
          <Button onClick={() => onNavigate("automations")}>Activar notificaciones</Button>
          <Button variant="default" onClick={() => onNavigate("brand")}>Compartir mi QR</Button>
        </Group>
        {conciergeExit}
      </Stack>
    );

  if (!programReady)
    return (
      <Stack className="panel" gap="sm" p="md">
        <Title order={2}>Pon tu programa en marcha</Title>
        <Text>Elige cómo premiar a tus clientes: cada opción muestra su regla y podrás ajustarla después. Para una regla propia, configúralo manualmente.</Text>
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
          {programPresets.map((preset) => (
            <Button
              key={preset.key}
              variant="default"
              h="auto"
              justify="start"
              className="preset-tile"
              loading={applying === preset.key}
              disabled={Boolean(applying) && applying !== preset.key}
              onClick={() => applyPreset(preset)}
            >
              <span className="preset-tile-body">
                <span className="preset-tile-emoji" aria-hidden="true">{preset.emoji}</span>
                <span className="preset-tile-label">{preset.label}</span>
                <span className="preset-tile-summary">{preset.summary}</span>
              </span>
            </Button>
          ))}
        </SimpleGrid>
        <Button variant="subtle" w="fit-content" onClick={() => onNavigate("launch")}>
          Prefiero configurarlo manualmente
        </Button>
        {conciergeExit}
      </Stack>
    );

  return (
    <Stack className="panel" gap="sm" p="md">
      <Title order={2}>Pon tu programa en marcha</Title>
      <Stack gap={6}>
        <Group gap="xs" wrap="nowrap">
          <Text aria-hidden="true" fw={700} c="teal">✓</Text>
          <Text c="dimmed">Tu programa está configurado</Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Text aria-hidden="true" fw={700} c="dimmed">○</Text>
          <Text fw={700}>Prepara una recompensa para tus clientes</Text>
        </Group>
      </Stack>
      <Button w="fit-content" onClick={() => onNavigate("rewards")}>Siguiente: Agregar recompensa</Button>
      {conciergeExit}
    </Stack>
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
      <Stack gap="lg">
        <Title order={1}>Tu negocio, con perspectiva</Title>
        <GuidedStart features={features} onNavigate={onNavigate} />
        {features.basic_reporting && (
          <Stack className="panel" gap="xs" p="md">
            <Title order={2}>Tus números básicos</Title>
            <Text>Clientes activos, compras registradas, premios usados y la capacidad de tu plan están en Reportes, incluido en tu plan.</Text>
            <BusinessLink href="/administracion/?seccion=reportes" display="inline-block">Abrir Reportes</BusinessLink>
          </Stack>
        )}
        <Locked feature="Análisis de resultados" />
        <Button w="fit-content" onClick={() => onNavigate("launch")}>
          Preparar mi programa
        </Button>
      </Stack>
    );
  const data = result.data,
    current = data?.current,
    previous = data?.previous;
  /** @type {[string, string, (value: number) => string, boolean?][]} */
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
      <GuidedStart features={features} onNavigate={onNavigate} hideWhenComplete />
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
          </>
        )
      )}
      {!result.loading && !result.error && data && (
          <>
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
                role="img"
                aria-label="Ventas registradas por día; los mismos datos están disponibles en la tabla."
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
              <Accordion.Item value="detail">
                <Accordion.Control>Ver análisis detallado</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xl">
                    <FirstPurchaseReturns branchId={branch||null} refresh={refresh}/>
                    <RewardExposurePanel branchId={branch||null} refresh={refresh}/>
                    <StaffActivityPanel branchId={branch||null} refresh={refresh}/>
                    <RedemptionReturns branchId={branch||null} refresh={refresh}/>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
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
      )}
    </Stack>
  );
}
