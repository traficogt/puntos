import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from "react";
import { useForm } from "@mantine/form";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { isDemo, api, useResource } from "./api.js";
import { Loading, Failure, Locked, BusinessLink } from "./ui.jsx";
import {
  editableRules,
  serializeRules,
  validateRules,
  campaignTemplate,
} from "./campaign-model.js";
export default function Campaigns({ features, onDirty }) {
  const [refresh, setRefresh] = useState(0);
  const resource = useResource(
    features.campaign_rules ? "/api/admin/campaign-rules" : null,
    refresh,
  );
  if (!features.campaign_rules) return <Locked feature="Campañas de puntos" />;
  if (resource.loading) return <Loading label="Cargando campañas…" />;
  if (resource.error)
    return (
      <Failure error={resource.error} retry={() => setRefresh((v) => v + 1)} />
    );
  if (!resource.data) return null;
  let rules;
  try {
    rules = editableRules(resource.data.rules);
  } catch (error) {
    return (
      <Alert color="yellow" title="Configuración avanzada">
        <Text>{error.message}</Text>
        <BusinessLink href="/administracion/?configurar=puntos">
          Abrir configuración avanzada
        </BusinessLink>
      </Alert>
    );
  }
  return (
    <Editor
      initialRules={rules}
      timezone={resource.data.timezone}
      onDirty={onDirty}
    />
  );
}
function Editor({ initialRules, timezone, onDirty }) {
  const form = useForm({ initialValues: { rules: initialRules } });
  const [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState(null),
    [opened, setOpened] = useState([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirty(false);
    };
  }, [onDirty]);
  const dirty = form.isDirty();
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const baseline = useRef(JSON.stringify(serializeRules(initialRules)));
  function add(kind) {
    if (saving) return;
    const index = form.values.rules.length;
    form.insertListItem("rules", campaignTemplate(kind));
    setOpened((values) => [...values, String(index)]);
    setFeedback(null);
  }
  async function save(event) {
    event.preventDefault();
    const invalid = validateRules(form.values.rules);
    if (invalid) {
      setFeedback({ error: true, text: invalid });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const latest = await api("/api/admin/campaign-rules");
      if (!alive.current) return;
      if (
        JSON.stringify(serializeRules(editableRules(latest.rules))) !==
        baseline.current
      )
        throw new Error(
          "Las campañas cambiaron en otra sesión. Copia tus ajustes y recarga la página antes de guardar.",
        );
      const result = await api("/api/admin/campaign-rules", {
        method: "PUT",
        body: JSON.stringify({ rules: serializeRules(form.values.rules) }),
      });
      if (!alive.current) return;
      const next = editableRules(result.rules);
      form.setValues({ rules: next });
      form.setInitialValues({ rules: next });
      form.resetDirty({ rules: next });
      baseline.current = JSON.stringify(serializeRules(next));
      setFeedback({
        error: false,
        text: isDemo
          ? "Demostración: cambios guardados solo en esta pestaña. Ningún negocio real fue modificado."
          : "Campañas guardadas. Las activas se aplican a las próximas compras que cumplan sus condiciones.",
      });
    } catch (error) {
      if (alive.current && error.name !== "AbortError")
        setFeedback({
          error: true,
          text:
            error.message ||
            "No se pudo guardar. Tus cambios siguen aquí para volver a intentarlo.",
        });
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  function discard() {
    if (!confirm("¿Descartar todos los cambios sin guardar?")) return;
    form.reset();
    setFeedback(null);
  }
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Dale un motivo para volver</Title>
        <Text className="intro">
          Prepara beneficios de puntos con reglas claras. Tú decides cuándo
          activarlos.
        </Text>
      </div>
      <Alert color="gray" title="Cómo se aplican">
        <Text size="sm">
          Las campañas activas se aplican en el orden de la lista y sus
          beneficios pueden acumularse. El horario se evalúa cuando PF procesa
          la compra{timezone ? `, en ${timezone}` : ""}, incluso si llega
          después de estar sin conexión. Guardar una campaña no envía mensajes a
          clientes.
        </Text>
      </Alert>
      <Group>
        <Button
          variant="default"
          disabled={saving || form.values.rules.length >= 100}
          onClick={() => add("weekend")}
        >
          Preparar doble puntos
        </Button>
        <Button
          variant="default"
          disabled={saving || form.values.rules.length >= 100}
          onClick={() => add("bonus")}
        >
          Preparar bono por compra
        </Button>
      </Group>
      <form onSubmit={save}>
        {!form.values.rules.length && (
          <Text py="xl">
            Aún no tienes campañas. Empieza con una plantilla: quedará
            desactivada hasta que la actives y guardes.
          </Text>
        )}
        <Accordion
          multiple
          value={opened}
          onChange={setOpened}
          variant="default"
        >
          {form.values.rules.map((rule, index) => {
            const path = `rules.${index}`,
              condition = `${path}.condition`;
            const field = (name) => form.getInputProps(`${path}.${name}`);
            const numberField = (name) => ({
              ...field(name),
              value: form.values.rules[index][name] ?? "",
            });
            const conditionField = (name) => ({
              ...form.getInputProps(`${condition}.${name}`),
              value: rule.condition?.[name] ?? "",
            });
            return (
              <Accordion.Item value={String(index)} key={index}>
                <Accordion.Control>
                  <Group justify="space-between" pr="sm">
                    <Text fw={500}>
                      {index + 1}. {rule.name || "Campaña sin nombre"}
                    </Text>
                    <Badge
                      color={rule.active === false ? "gray" : "terra"}
                      variant="light"
                    >
                      {rule.active === false ? "Desactivada" : "Activa"}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <fieldset
                    disabled={saving}
                    style={{ border: 0, padding: 0, margin: 0 }}
                  >
                    <Stack gap="lg">
                      <TextInput
                        label="Nombre de la campaña"
                        maxLength={120}
                        required
                        {...field("name")}
                      />
                      <Switch
                        label="Activar al guardar"
                        checked={rule.active !== false}
                        onChange={(event) =>
                          form.setFieldValue(
                            `${path}.active`,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <Select
                          label="Beneficio"
                          allowDeselect={false}
                          data={[
                            {
                              value: "multiplier",
                              label: "Multiplicar puntos",
                            },
                            {
                              value: "bonus_points",
                              label: "Sumar puntos extra",
                            },
                          ]}
                          {...field("kind")}
                        />
                        <NumberInput
                          label={
                            rule.kind === "multiplier"
                              ? "Multiplicador (2 = doble puntos)"
                              : "Puntos extra"
                          }
                          min={0.000001}
                          required
                          {...numberField("value")}
                        />
                        <Select
                          label="Tipo de programa"
                          data={[
                            { value: "", label: "Cualquier tipo" },
                            { value: "SPEND", label: "Por gasto" },
                            { value: "VISIT", label: "Por visita" },
                            { value: "ITEM", label: "Por artículo" },
                          ]}
                          value={rule.program_type || ""}
                          onChange={(value) =>
                            form.setFieldValue(
                              `${path}.program_type`,
                              value || "",
                            )
                          }
                        />
                        <NumberInput
                          label="Límite de puntos tras esta regla"
                          description="Opcional. Limita el total acumulado hasta esta campaña; 0 significa sin límite."
                          min={0}
                          {...numberField("max_points")}
                        />
                      </SimpleGrid>
                      <Checkbox.Group
                        label="Días de la semana"
                        description="Sin selección: todos los días."
                        value={(rule.condition?.weekdays || []).map(String)}
                        onChange={(values) =>
                          form.setFieldValue(
                            `${condition}.weekdays`,
                            values.map(Number),
                          )
                        }
                      >
                        <Group mt="xs" gap="md">
                          {[
                            "Dom",
                            "Lun",
                            "Mar",
                            "Mié",
                            "Jue",
                            "Vie",
                            "Sáb",
                          ].map((day, i) => (
                            <Checkbox value={String(i)} label={day} key={day} />
                          ))}
                        </Group>
                      </Checkbox.Group>
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <NumberInput
                          label="Desde la hora (0–23)"
                          description="Opcional. Por ejemplo, 9 significa 09:00."
                          min={0}
                          max={23}
                          decimalScale={0}
                          {...conditionField("start_hour")}
                        />
                        <NumberInput
                          label="Hasta la hora inclusive (0–23)"
                          description="Opcional. Por ejemplo, 18 incluye hasta las 18:59."
                          min={0}
                          max={23}
                          decimalScale={0}
                          {...conditionField("end_hour")}
                        />
                      </SimpleGrid>
                      <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <NumberInput
                          label={`Compra mínima (${merchantRegion().currency})`}
                          min={0}
                          decimalScale={merchantRegion().minorUnits}
                          {...conditionField("min_amount_q")}
                        />
                        <NumberInput
                          label="Visitas mínimas"
                          min={0}
                          {...conditionField("min_visits")}
                        />
                        <NumberInput
                          label="Artículos mínimos"
                          min={0}
                          {...conditionField("min_items")}
                        />
                      </SimpleGrid>
                      <Button
                        variant="subtle"
                        color="red"
                        w="fit-content"
                        onClick={() => {
                          if (
                            confirm(
                              "¿Quitar esta campaña? Se eliminará al guardar.",
                            )
                          )
                            form.removeListItem("rules", index);
                        }}
                      >
                        Quitar campaña
                      </Button>
                    </Stack>
                  </fieldset>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
        {feedback && (
          <Alert
            mt="lg"
            color={feedback.error ? "red" : "green"}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.text}
          </Alert>
        )}
        <Group className="campaign-actions" justify="space-between" mt="xl">
          <Text size="sm" c="dimmed">
            {dirty
              ? "Tienes cambios sin guardar."
              : "Todos los cambios están guardados."}
          </Text>
          <Group>
            <Button
              variant="default"
              disabled={!dirty || saving}
              onClick={discard}
            >
              Descartar
            </Button>
            <Button type="submit" loading={saving} disabled={!dirty}>
              Guardar campañas
            </Button>
          </Group>
        </Group>
      </form>
    </Stack>
  );
}
