import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { api, isDemo, useResource } from "./api.js";
import { Failure, Loading, Locked, money, number } from "./ui.jsx";
const base = "/api/admin/analytics/recovery";
const date = (v) =>
  v
    ? new Intl.DateTimeFormat(merchantRegion().locale, {
        dateStyle: "medium",
        timeZone: merchantRegion().timezone,
      }).format(new Date(v))
    : "—";
export default function Recovery({ features, onDirty }) {
  return features.analytics ? (
    <Workspace onDirty={onDirty} />
  ) : (
    <Locked feature="Recuperar clientes" />
  );
}
function Workspace({ onDirty }) {
  const [threshold, setThreshold] = useState("30"),
    [version, setVersion] = useState(0),
    [selected, setSelected] = useState(""),
    [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lastPayload = useRef("");
  const requestId = useRef(crypto.randomUUID()),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const form = useForm({
    initialValues: { name: "", notes: "", limit: 50 },
    validate: {
      name: (v) =>
        v.trim().length > 0 && v.trim().length <= 100
          ? null
          : "Escribe un nombre de hasta 100 caracteres.",
      limit: (v) =>
        Number.isInteger(v) && v >= 1 && v <= 200
          ? null
          : "Selecciona entre 1 y 200 clientes.",
    },
  });
  const [memberState, setMemberState] = useState({
    editing: false,
    pending: false,
  });
  const dirty = form.isDirty() || memberState.editing;
  function canLeaveMember() {
    if (memberState.pending) return false;
    return (
      !memberState.editing ||
      confirm("Tienes un contacto sin registrar. ¿Quieres descartarlo?")
    );
  }
  useEffect(() => {
    onDirty(dirty || busy || memberState.pending);
    return () => onDirty(false);
  }, [dirty, busy, memberState.pending, onDirty]);
  const audience = useResource(
    `${base}/audience?inactive_days=${threshold}&limit=10&offset=0`,
    version,
  );
  const runs = useResource(`${base}/runs`, version);
  const detail = useResource(
    selected ? `${base}/runs/${selected}?limit=25&offset=${offset}` : null,
    version,
  );
  const refresh = () => setVersion((v) => v + 1);
  async function create(values) {
    if (busy || !canLeaveMember()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        ...values,
        name: values.name.trim(),
        inactive_days: Number(threshold),
      };
      const signature = JSON.stringify(payload);
      if (lastPayload.current && lastPayload.current !== signature)
        requestId.current = crypto.randomUUID();
      lastPayload.current = signature;
      const out = await api(`${base}/runs`, {
        method: "POST",
        body: JSON.stringify({ ...payload, request_id: requestId.current }),
      });
      if (!alive.current) return;
      setSelected(out.run.id);
      setOffset(0);
      form.reset();
      requestId.current = crypto.randomUUID();
      refresh();
      setNotice(
        isDemo
          ? "Lista de ejemplo guardada solo en esta pestaña."
          : "Lista guardada. No se ha enviado ningún mensaje.",
      );
    } catch (e) {
      if (alive.current && e.name !== "AbortError")
        setError(
          e.message || "No se pudo guardar la lista. Inténtalo de nuevo.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const run = detail.data?.run;
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Recuperar clientes</Title>
        <Text c="dimmed" mt="sm" maw={720}>
          Organiza el seguimiento de quienes no tienen compras recientes registradas y
          comprueba si vuelven. Usamos las compras registradas en PF.
        </Text>
      </div>
      <section aria-labelledby="audience-title">
        <Group justify="space-between" align="end" mb="md">
          <Title order={2} id="audience-title">
            A quién dar seguimiento
          </Title>
          <Select
            label="Sin compras registradas desde hace"
            value={threshold}
            onChange={(v) => {
              setThreshold(v || "30");
              requestId.current = crypto.randomUUID();
            }}
            disabled={busy || memberState.pending}
            allowDeselect={false}
            data={[
              { value: "30", label: "30 días o más" },
              { value: "60", label: "60 días o más" },
              { value: "90", label: "90 días o más" },
            ]}
          />
        </Group>
        {audience.loading ? (
          <Loading />
        ) : audience.error ? (
          <Failure error={audience.error} retry={refresh} />
        ) : audience.data?.paused ? (
          <Alert color="yellow" title="Datos pendientes de completar">{audience.data.data_readiness.summary} La lista volverá a estar disponible cuando se complete la importación.</Alert>
        ) : (
          <>
            <Text mb="md">
              <strong>{number(audience.data?.total || 0)} clientes</strong>{" "}
              cumplen este criterio. Priorizados por el valor de sus compras
              anteriores.
            </Text>
            {audience.data?.customers?.length ? (
              <Table.ScrollContainer minWidth={520} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: "region", "aria-label": "Clientes que cumplen el criterio" } }}>
                <Table captionSide="bottom">
                  <Table.Caption>
                    Vista previa de hasta 10 clientes. La lista se calcula de
                    nuevo al guardarla.
                  </Table.Caption>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Última compra</Table.Th>
                      <Table.Th ta="right">Compras anteriores</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {audience.data.customers.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>{c.name || "Cliente sin nombre"}</Table.Td>
                        <Table.Td>{date(c.last_purchase_at)}</Table.Td>
                        <Table.Td ta="right">
                          {money(c.recorded_sales_q)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text py="md">
                No hay clientes con compras anteriores que cumplan este
                criterio. Prueba otro período o registra las compras de tu
                negocio.
              </Text>
            )}
          </>
        )}
        <form onSubmit={form.onSubmit(create)} className="recovery-form">
          <Group align="start" grow>
            <TextInput
              label="Nombre de la lista"
              placeholder="Seguimiento de noviembre"
              maxLength={100}
              disabled={busy || memberState.pending}
              {...form.getInputProps("name")}
            />
            <NumberInput
              label="Máximo de clientes"
              min={1}
              max={200}
              allowDecimal={false}
              disabled={busy || memberState.pending}
              {...form.getInputProps("limit")}
            />
          </Group>
          <Textarea
            label="Notas para el equipo (opcional)"
            description="Estas notas no crean descuentos ni envían mensajes."
            maxLength={500}
            disabled={busy || memberState.pending}
            {...form.getInputProps("notes")}
          />
          <Button
            type="submit"
            loading={busy}
            disabled={
              audience.loading ||
              !!audience.error ||
              !audience.data?.total ||
              memberState.pending
            }
          >
            Guardar lista de seguimiento
          </Button>
        </form>
        {error && (
          <Alert color="red" mt="md" role="alert">
            {error}
          </Alert>
        )}
        {notice && (
          <Text mt="md" role="status">
            {notice}
          </Text>
        )}
      </section>
      <section aria-labelledby="lists-title">
        <Title order={2} id="lists-title" mb="md">
          Tus listas de seguimiento
        </Title>
        {runs.loading ? (
          <Loading />
        ) : runs.error ? (
          <Failure error={runs.error} retry={refresh} />
        ) : runs.data?.runs?.length ? (
          <Group gap="sm" mb="lg">
            {runs.data.runs.map((r) => (
              <Button
                key={r.id}
                variant={selected === r.id ? "filled" : "default"}
                disabled={busy || memberState.pending}
                onClick={() => {
                  if (!canLeaveMember()) return;
                  setSelected(r.id);
                  setOffset(0);
                  setNotice("");
                }}
              >
                {r.name}
              </Button>
            ))}
          </Group>
        ) : (
          <Text c="dimmed">
            Las listas que guardes aparecerán aquí. Puedes retomarlas cuando
            vuelvas al panel.
          </Text>
        )}
        {selected &&
          (detail.loading ? (
            <Loading />
          ) : detail.error ? (
            <Failure error={detail.error} retry={refresh} />
          ) : (
            run && (
              <Stack gap="md">
                <div>
                  <Title order={3}>{run.name}</Title>
                  <Text size="sm" c="dimmed">
                    Creada el {date(run.created_at)} ·{" "}
                    {number(run.member_count)} clientes al guardar
                  </Text>
                  {run.notes && <Text mt="sm">{run.notes}</Text>}
                </div>
                <Group gap="xl" className="recovery-results">
                  <div>
                    <Text size="sm">Contactados por tu equipo</Text>
                    <Text fw={600}>{number(run.contacted_count)}</Text>
                  </div>
                  <div>
                    <Text size="sm">Volvieron después del contacto</Text>
                    <Text fw={600}>{number(run.returned_count)}</Text>
                  </div>
                  <div>
                    <Text size="sm">Compras registradas después</Text>
                    <Text fw={600}>
                      {money(run.recorded_sales_after_contact_q)}
                    </Text>
                  </div>
                </Group>
                <Text size="sm" c="dimmed">
                  Medimos los 30 días siguientes a cada contacto registrado,
                  hasta hoy. Que un cliente vuelva no demuestra que el contacto
                  causó la compra. PF no envía mensajes desde esta sección.
                </Text>
                <MemberList
                  key={`${selected}-${offset}`}
                  members={detail.data.members || []}
                  runId={selected}
                  onChange={refresh}
                  onState={setMemberState}
                  locked={busy}
                />
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={offset === 0 || memberState.pending}
                    onClick={() => {
                      if (canLeaveMember())
                        setOffset((v) => Math.max(0, v - 25));
                    }}
                  >
                    Anteriores
                  </Button>
                  <Text size="sm">
                    {number(detail.data.total ? offset + 1 : 0)}–
                    {number(Math.min(offset + 25, detail.data.total || 0))} de{" "}
                    {number(detail.data.total || 0)}
                  </Text>
                  <Button
                    variant="default"
                    disabled={
                      offset + 25 >= (detail.data.total || 0) ||
                      memberState.pending
                    }
                    onClick={() => {
                      if (canLeaveMember()) setOffset((v) => v + 25);
                    }}
                  >
                    Siguientes
                  </Button>
                </Group>
              </Stack>
            )
          ))}
      </section>
    </Stack>
  );
}
function MemberList({ members, runId, onChange, onState, locked }) {
  const [confirming, setConfirming] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onState({ editing: !!confirming, pending: !!pending });
    return () => onState({ editing: false, pending: false });
  }, [confirming, pending, onState]);
  async function mark(customerId, status) {
    if (pending || locked) return;
    setPending(customerId);
    setError("");
    try {
      await api(`${base}/runs/${runId}/members/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(status === "contacted" ? { contact_confirmed: confirmed } : {}),
        }),
      });
      if (!alive.current) return;
      setConfirming("");
      setConfirmed(false);
      onChange();
    } catch (e) {
      if (alive.current && e.name !== "AbortError")
        setError(e.message || "No se pudo guardar el seguimiento.");
    } finally {
      if (alive.current) setPending("");
    }
  }
  return (
    <>
      <Text size="sm">
        Marca «Ya lo contacté» después de realizar el seguimiento autorizado por
        tu canal habitual.
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Table.ScrollContainer minWidth={650} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: "region", "aria-label": "Seguimiento de clientes" } }}>
        <Table verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Cliente</Table.Th>
              <Table.Th>Contacto</Table.Th>
              <Table.Th>Seguimiento</Table.Th>
              <Table.Th>Resultado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((m) => (
              <Table.Tr key={m.customer_id}>
                <Table.Td>
                  {m.name || "Cliente sin nombre"}
                  <Text size="xs" c="dimmed">
                    Última compra anterior: {date(m.last_purchase_at)}
                    <br />
                    Compras anteriores: {money(m.recorded_sales_q)}
                  </Text>
                </Table.Td>
                <Table.Td>{m.phone || "Sin teléfono"}</Table.Td>
                <Table.Td>
                  {m.status === "pending" ? (
                    confirming === m.customer_id ? (
                      <Stack gap="xs" maw={340}>
                        <Checkbox
                          label="Confirmo que este cliente autorizó el contacto y que ya lo contacté."
                          disabled={locked || !!pending}
                            checked={confirmed}
                          onChange={(e) =>
                            setConfirmed(e.currentTarget.checked)
                          }
                        />
                        <Group gap="xs">
                          <Button
                            size="xs"
                            disabled={!confirmed || !!pending || locked}
                            loading={pending === m.customer_id}
                            onClick={() => mark(m.customer_id, "contacted")}
                          >
                            Registrar contacto
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            disabled={!!pending || locked}
                            onClick={() => setConfirming("")}
                          >
                            Cancelar
                          </Button>
                        </Group>
                      </Stack>
                    ) : (
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="default"
                          disabled={!!pending || locked}
                          onClick={() => {
                            setConfirming(m.customer_id);
                            setConfirmed(false);
                          }}
                        >
                          Ya lo contacté
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          disabled={!!pending || locked}
                          onClick={() => mark(m.customer_id, "skipped")}
                        >
                          Omitir
                        </Button>
                      </Group>
                    )
                  ) : (
                    <Badge
                      color={m.status === "contacted" ? "teal" : "gray"}
                      variant="light"
                    >
                      {m.status === "contacted"
                        ? `Contactado · ${date(m.contacted_at)}`
                        : "Omitido"}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {m.returned_at ? (
                    <>
                      <Text fw={600}>Volvió el {date(m.returned_at)}</Text>
                      <Text size="sm">
                        {money(m.recorded_sales_after_contact_q)} registrados
                      </Text>
                    </>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {m.status === "contacted"
                        ? "Sin regreso registrado"
                        : "—"}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  );
}
