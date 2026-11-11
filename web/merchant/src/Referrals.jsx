import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from "react";
import { useForm } from "@mantine/form";
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Fieldset,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { api, isDemo, useResource } from "./api.js";
import {
  BusinessLink,
  Failure,
  Loading,
  Locked,
  number,
  periodDate,
} from "./ui.jsx";
import {
  editableReferralSettings,
  enrollmentLink,
  referralPayload,
  referralTriggerText,
  validateReferralSettings,
} from "./referral-model.js";

const noop = () => {};
const pageSize = 10;
const rewardLabels = {
  pending: "Pendiente",
  completed: "Completado",
  rewarded: "Premio registrado",
};

export default function Referrals({ features, staff, onDirty = noop }) {
  const [refresh, setRefresh] = useState(0);
  const settings = useResource(
    features.referrals ? "/api/admin/referral-settings" : null,
    refresh,
  );
  if (!features.referrals) return <Locked feature="Recomendaciones" />;
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>De una recomendación a una primera compra</Title>
        <Text className="intro">
          Revisa qué pasa con los clientes recomendados y define el incentivo
          para quien invita y quien llega.
        </Text>
      </div>
      <ReferralResults />
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="xl">
        <section aria-labelledby="referral-settings-title">
          <Title order={2} id="referral-settings-title">
            El incentivo de tu programa
          </Title>
          {settings.loading ? (
            <Loading label="Cargando incentivos…" />
          ) : settings.error ? (
            <Failure
              error={settings.error}
              retry={() => setRefresh((value) => value + 1)}
            />
          ) : (
            settings.data && (
              <IncentiveEditor
                initialSettings={settings.data.settings}
                onDirty={onDirty}
              />
            )
          )}
        </section>
        <Enrollment staff={staff} />
      </SimpleGrid>
    </Stack>
  );
}

function ReferralResults() {
  const [days, setDays] = useState("30");
  const [phase, setPhase] = useState("all");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const resource = useResource(
    `/api/admin/referral-growth?days=${days}&phase=${phase}&limit=${pageSize}&offset=${offset}`,
    refresh,
  );
  const result = resource.data;
  return (
    <section aria-labelledby="referral-results-title">
      <Group justify="space-between" align="end" gap="md" mb="md">
        <div>
          <Title order={2} id="referral-results-title">
            Cómo avanzan las recomendaciones
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Se agrupan por la fecha en que se registró el código de
            recomendación.
          </Text>
        </div>
        <Select
          label="Recomendaciones registradas"
          value={days}
          onChange={(value) => {
            setDays(value || "30");
            setOffset(0);
          }}
          allowDeselect={false}
          data={[
            { value: "30", label: "En los últimos 30 días" },
            { value: "90", label: "En los últimos 90 días" },
          ]}
        />
      </Group>
      {resource.loading ? (
        <Loading label="Consultando recomendaciones y compras…" />
      ) : resource.error ? (
        <Failure
          error={resource.error}
          retry={() => setRefresh((value) => value + 1)}
        />
      ) : (
        result && (
          <Stack gap="lg">
            <Text size="sm" c="dimmed">
              Del {periodDate(result.period.start, result.timezone)} al{" "}
              {periodDate(result.period.end, result.timezone)}. Compras
              observadas hasta esta consulta.
            </Text>
            <Table
              verticalSpacing="md"
              aria-label="Recorrido de las recomendaciones"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Recorrido</Table.Th>
                  <Table.Th ta="right">Clientes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Registrados con código de recomendación</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {number(result.summary.registered)}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>De ellos, con una compra registrada</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {number(result.summary.purchased)}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>
                    De quienes compraron, con premio registrado
                  </Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {number(result.summary.purchased_and_rewarded)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            {result.summary.registered > 0 ? (
              <Text size="sm">
                <strong>{number(result.summary.purchase_rate_pct)}%</strong>{" "}
                tiene al menos una compra registrada desde la recomendación.{" "}
                <strong>{number(result.summary.awaiting_purchase)}</strong> aún
                no tiene una compra registrada.
              </Text>
            ) : (
              <Alert
                title="Todavía no hay recomendaciones en este período"
                color="gray"
              >
                Activa el incentivo y explica a tus clientes cómo compartir su
                código desde su tarjeta. Las nuevas recomendaciones aparecerán
                cuando se aplique un código.
              </Alert>
            )}
            <div>
              <Text fw={600} size="sm" mb="xs">
                Estado de los premios de todo el grupo
              </Text>
              <Group gap="xs">
                <Badge variant="light" color="gray">
                  {number(result.summary.reward_status.pending)} pendientes
                </Badge>
                <Badge variant="light" color="gray">
                  {number(result.summary.reward_status.completed)} completados
                </Badge>
                <Badge variant="light" color="gray">
                  {number(result.summary.reward_status.rewarded)} con premio
                  registrado
                </Badge>
                {result.summary.reward_status.other > 0 && (
                  <Badge variant="light" color="gray">
                    {number(result.summary.reward_status.other)} con otro estado
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt="xs">
                {number(result.summary.recorded_reward_points)} puntos con abono
                registrado entre ambas personas. Un premio al registro puede
                existir sin compra; no es una etapa posterior de todas las
                recomendaciones.
              </Text>
            </div>
            <Group justify="space-between" align="end">
              <Title order={3}>Detalle de las recomendaciones</Title>
              <Select
                label="Mostrar clientes recomendados"
                value={phase}
                onChange={(value) => {
                  setPhase(value || "all");
                  setOffset(0);
                }}
                allowDeselect={false}
                data={[
                  { value: "all", label: "Todos" },
                  {
                    value: "awaiting_purchase",
                    label: "Sin compra registrada",
                  },
                  { value: "purchased", label: "Con compra registrada" },
                ]}
              />
            </Group>
            {result.referrals.length ? (
              <Table.ScrollContainer
                minWidth={660}
                type="native"
                tabIndex={0}
                role="region"
                aria-label="Desplazar clientes recomendados"
              >
                <Table verticalSpacing="sm" aria-label="Clientes recomendados">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Quien recomendó</Table.Th>
                      <Table.Th>Registro</Table.Th>
                      <Table.Th>Primera compra</Table.Th>
                      <Table.Th>Premio</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.referrals.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          {row.referred_name || "Cliente no disponible"}
                        </Table.Td>
                        <Table.Td>
                          {row.referrer_name || "Cliente no disponible"}
                        </Table.Td>
                        <Table.Td>
                          {periodDate(row.created_at, result.timezone)}
                        </Table.Td>
                        <Table.Td>
                          {row.first_purchase_at
                            ? periodDate(row.first_purchase_at, result.timezone)
                            : "Sin compra registrada"}
                        </Table.Td>
                        <Table.Td>
                          {rewardLabels[row.status] || "Otro estado"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text size="sm" c="dimmed">
                No hay recomendaciones con este filtro.
              </Text>
            )}
            {result.pagination.total > 0 && (
              <Group justify="space-between">
                <Text size="sm" role="status">
                  {offset + 1}–
                  {Math.min(offset + pageSize, result.pagination.total)} de{" "}
                  {number(result.pagination.total)}
                </Text>
                <Group gap="xs">
                  <Button
                    variant="default"
                    disabled={offset === 0}
                    onClick={() =>
                      setOffset((value) => Math.max(0, value - pageSize))
                    }
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="default"
                    disabled={!result.pagination.has_more || offset >= 10000}
                    onClick={() => setOffset((value) => value + pageSize)}
                  >
                    Siguiente
                  </Button>
                </Group>
              </Group>
            )}
            <Accordion variant="default">
              <Accordion.Item value="definition">
                <Accordion.Control>Qué mide este seguimiento</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {result.notes.map((note) => (
                      <Text key={note} size="sm">
                        {note}
                      </Text>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        )
      )}
    </section>
  );
}

function IncentiveEditor({ initialSettings, onDirty }) {
  const form = useForm({
    initialValues: editableReferralSettings(initialSettings),
  });
  const baseline = useRef(
    JSON.stringify(referralPayload(editableReferralSettings(initialSettings))),
  );
  const alive = useRef(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const dirty = form.isDirty();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirty(false);
    };
  }, [onDirty]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  async function save(event) {
    event.preventDefault();
    const invalid = validateReferralSettings(form.values);
    if (invalid) {
      setFeedback({ error: true, text: invalid });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const latest = await api("/api/admin/referral-settings");
      if (!alive.current) return;
      if (
        JSON.stringify(
          referralPayload(editableReferralSettings(latest.settings)),
        ) !== baseline.current
      )
        throw new Error(
          "Los incentivos cambiaron en otra sesión. Anota tus ajustes y recarga la página antes de guardar.",
        );
      const result = await api("/api/admin/referral-settings", {
        method: "PUT",
        body: JSON.stringify(referralPayload(form.values)),
      });
      if (!alive.current) return;
      const next = editableReferralSettings(result.settings);
      form.setValues(next);
      form.setInitialValues(next);
      form.resetDirty(next);
      baseline.current = JSON.stringify(referralPayload(next));
      setFeedback({
        error: false,
        text: isDemo
          ? "Demostración: incentivos guardados solo en esta pestaña. Ningún negocio real fue modificado."
          : "Incentivos guardados. Las recomendaciones ya premiadas conservan su registro.",
      });
    } catch (error) {
      if (alive.current && error.name !== "AbortError")
        setFeedback({
          error: true,
          text: error.status
            ? "No pudimos guardar los incentivos. Tus ajustes siguen aquí; revisa la conexión y tus permisos e inténtalo de nuevo."
            : error.message,
        });
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className="campaign-editor">
      <Stack gap="lg">
        <Fieldset disabled={saving} variant="unstyled">
          <Stack gap="md">
            <Switch
              label="Habilitar recomendaciones"
              description="Permite que tus clientes obtengan y compartan su código desde su tarjeta."
              {...form.getInputProps("enabled", { type: "checkbox" })}
            />
            <Text size="sm" c="dimmed">
              Los códigos ya compartidos pueden seguir usándose. Desactivar no
              cancela recomendaciones pendientes ni revierte puntos ya entregados.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label="Puntos para quien recomienda"
                min={0}
                max={100000}
                allowDecimal={false}
                allowNegative={false}
                {...form.getInputProps("referrer_reward_points")}
              />
              <NumberInput
                label="Puntos para el nuevo cliente"
                min={0}
                max={100000}
                allowDecimal={false}
                allowNegative={false}
                {...form.getInputProps("referred_reward_points")}
              />
            </SimpleGrid>
            <Select
              label="Cuándo se evalúa el premio"
              value={form.values.reward_on_signup ? "signup" : "purchase"}
              onChange={(value) =>
                form.setFieldValue("reward_on_signup", value === "signup")
              }
              allowDeselect={false}
              data={[
                { value: "purchase", label: "Al procesar una compra" },
                {
                  value: "signup",
                  label: "Al aplicar el código en el registro",
                },
              ]}
            />
            {!form.values.reward_on_signup && (
              <NumberInput
                label={`Importe acumulado mínimo (${merchantRegion().currency})`}
                description="Usa 0 para no exigir un importe mínimo. Se considera el acumulado registrado del cliente, no una sola compra."
                min={0}
                max={99999999.99}
                decimalScale={merchantRegion().minorUnits}
                allowNegative={false}
                {...form.getInputProps("min_purchase_to_complete")}
              />
            )}
          </Stack>
        </Fieldset>
        <div>
          <Text fw={600} size="sm">
            Así se aplicarán tus ajustes
          </Text>
          <Text size="sm" mt="xs">
            {referralTriggerText(form.values)}
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            Las reglas actuales también pueden aplicarse a recomendaciones
            pendientes. El informe de compras no recalcula los premios ni
            sustituye su estado registrado.
          </Text>
        </div>
        {feedback && (
          <Alert
            color={feedback.error ? "red" : "green"}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.text}
          </Alert>
        )}
        <Group pt="md" gap="sm">
          <Button type="submit" mih={44} loading={saving} disabled={!dirty}>
            Guardar incentivos
          </Button>
          <Button
            variant="subtle"
            disabled={!dirty || saving}
            onClick={() => {
              form.reset();
              setFeedback(null);
            }}
          >
            Descartar cambios
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function Enrollment({ staff }) {
  const [refresh, setRefresh] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [qrError, setQrError] = useState(false);
  const resource = useResource("/api/admin/customer-enrollment", refresh);
  const url = isDemo
    ? `${location.origin}/demostracion/#preparar`
    : enrollmentLink(resource.data, staff?.business_id);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setFeedback("Enlace copiado.");
    } catch {
      setFeedback(
        "No se pudo copiar. Selecciona el enlace y cópialo manualmente.",
      );
    }
  }
  return (
    <section
      className="enrollment"
      aria-labelledby="referral-enrollment-title"
      style={{ alignSelf: "start" }}
    >
      <Title order={2} id="referral-enrollment-title">
        También puedes invitar desde tu negocio
      </Title>
      <Text size="sm" mt="sm">
        Comparte este enlace en tus canales o coloca el QR en caja para abrir la
        inscripción pública.
      </Text>
      <Text size="sm" fw={600} mt="sm">
        Este QR no identifica a quien recomienda. Solo las inscripciones con un
        código aplicado aparecen en el seguimiento de recomendaciones.
      </Text>
      {resource.loading ? (
        <Loading label="Preparando el enlace de inscripción…" />
      ) : resource.error || !url ? (
        <Failure
          error={resource.error}
          retry={() => setRefresh((value) => value + 1)}
        />
      ) : (
        <Stack align="start" gap="md" mt="lg">
          {isDemo && (
            <Text size="sm">
              QR de demostración: abre una vista previa y no inscribe clientes.
            </Text>
          )}
          {qrError ? (
            <Alert color="yellow">
              No se pudo cargar el QR. Usa el enlace o vuelve a cargarlo.
            </Alert>
          ) : (
            <img
              src={
                isDemo
                  ? "/merchant-demo-qr.svg"
                  : "/api/admin/customer-enrollment/qr.svg"
              }
              alt={
                isDemo
                  ? "QR de demostración"
                  : `QR de inscripción de ${resource.data.business.name}`
              }
              width="192"
              height="192"
              onError={() => setQrError(true)}
            />
          )}
          <TextInput
            label={
              isDemo
                ? "Enlace de demostración"
                : "Enlace de inscripción pública"
            }
            readOnly
            value={url}
            w="100%"
            onFocus={(event) => event.target.select()}
          />
          <Group gap="sm">
            <Button mih={44} onClick={copy}>Copiar enlace</Button>
            <Button
              component="a"
              href={
                isDemo
                  ? "/merchant-demo-qr.svg"
                  : "/api/admin/customer-enrollment/qr.svg?download=1"
              }
              download
              variant="default"
            >
              Descargar QR
            </Button>
            {qrError && (
              <Button variant="subtle" onClick={() => setQrError(false)}>
                Recargar QR
              </Button>
            )}
          </Group>
          <Text size="sm" role="status">
            {feedback}
          </Text>
          <Anchor href={url} target="_blank" rel="noopener noreferrer">
            {isDemo ? "Abrir vista previa" : "Ver inscripción pública"}
          </Anchor>
          <Text size="sm" c="dimmed">
            Antes de publicar, prueba el registro y confirma que el negocio
            puede entregar los códigos de verificación.
          </Text>
          <BusinessLink href="/negocio/#preparar">
            Revisar la preparación de mi programa
          </BusinessLink>
        </Stack>
      )}
    </section>
  );
}
