import {merchantRegion} from './region.js';
import { useEffect, useState } from "react";
import { Accordion, Alert, Anchor, Button, Group, List, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { BusinessLink } from "./ui.jsx";
import { connectionModes } from "./pos-model.js";
import { buildPosHandoff } from "./pos-handoff-model.js";
import { buildInstallationPackage, installationCapabilities, installationDeployments, installationFixtures, installationPlan, installationPlans, installationVendors, validateInstallationFixture } from "./pos-installation-model.js";

export default function PosInstallation({ initialMode, selectedMode, onSelectMode, onDirty, disabled = false }) {
  const [values, setValues] = useState({ vendor: initialMode === "loyverse" ? "loyverse" : "other", name: "", version: "", deployment: "unknown", capability: initialMode === "csv" ? "csv" : "unknown", plan: "unknown" });
  const [profileDirty, setProfileDirty] = useState(false);
  const [fixtureDirty, setFixtureDirty] = useState(false);
  const [fixture, setFixture] = useState(() => JSON.stringify(installationFixtures(merchantRegion()).sale, null, 2));
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { onDirty(profileDirty || fixtureDirty); return () => onDirty(false); }, [profileDirty, fixtureDirty, onDirty]);
  const plan = installationPlan(values);
  const modeLabel = connectionModes.find(mode => mode.value === plan.mode)?.label;
  function update(key, value) {
    setValues(previous => ({ ...previous, [key]: value || "", ...(key === "vendor" ? { deployment: "unknown", plan: "unknown", capability: "unknown", name: "", version: "" } : {}) }));
    setProfileDirty(true); setError(""); setNotice("");
  }
  function download(format) {
    setError(""); setNotice("");
    try {
      const pkg = buildInstallationPackage(values,merchantRegion());
      const content = format === "json" ? JSON.stringify(pkg, null, 2) : buildPosHandoff({
        vendor: pkg.profile.name, version: pkg.profile.version,
        deployment: installationDeployments.find(option => option.value === pkg.profile.deployment)?.label,
        capability: modeLabel || "Por confirmar", installation: pkg,
      });
      const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `instalacion-pos-puntosfieles.${format === "json" ? "json" : "txt"}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProfileDirty(false); setNotice("Paquete preparado para descargar. No se habilitó una conexión ni se guardaron resultados de pruebas.");
    } catch (cause) { setError(cause.message || "No se pudo preparar el paquete. Revisa los datos e inténtalo de nuevo."); }
  }
  return <section aria-labelledby="pos-method-title"><Stack gap="lg">
    <div><Title order={2} id="pos-method-title" mb="xs">Encuentra el método para tu caja</Title><Text maw={720}>Identifica tu sistema, revisa lo que necesita y prepara una entrega que tu instalador pueda repetir en otra sucursal.</Text></div>
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <Select label="Sistema de caja" value={values.vendor} onChange={value => update("vendor", value)} data={installationVendors} allowDeselect={false} disabled={disabled} />
      {values.vendor !== "loyverse" && <Select label="Cómo comparte ventas" value={values.capability} onChange={value => update("capability", value)} data={installationCapabilities} allowDeselect={false} disabled={disabled} />}
      {values.vendor === "odoo" && <Select label="Alojamiento de Odoo" value={values.deployment} onChange={value => update("deployment", value)} data={installationDeployments.filter(option => ["unknown", "online", "odoo_sh", "self_hosted"].includes(option.value))} allowDeselect={false} disabled={disabled} />}
      {values.vendor === "odoo" && values.deployment === "online" && <Select label="Plan de Odoo Online" value={values.plan} onChange={value => update("plan", value)} data={installationPlans} allowDeselect={false} disabled={disabled} />}
    </SimpleGrid>
    <Stack gap="sm" maw={760}>
      <Title order={3}>{plan.title}</Title><Text>{plan.detail}</Text><Text size="sm"><strong>En caja:</strong> {plan.cashier}</Text>
      {plan.mode ? <Button variant="default" w="fit-content" disabled={disabled || selectedMode === plan.mode} onClick={() => onSelectMode(plan.mode)}>{selectedMode === plan.mode ? "Método seleccionado abajo" : `Preparar ${modeLabel}`}</Button> : <BusinessLink href="/equipo/escaner/">Abrir caja de PF</BusinessLink>}
    </Stack>
    <Accordion multiple variant="default">
      <Accordion.Item value="requirements"><Accordion.Control>Requisitos y trabajo sin conexión</Accordion.Control><Accordion.Panel>
        <Stack gap="md" maw={760}><List spacing="sm">{plan.prerequisites.map(item => <List.Item key={item}>{item}</List.Item>)}</List>
          <Text size="sm">{plan.versionNote}</Text><Text size="sm"><strong>Sin internet:</strong> {plan.offline}</Text>
          <Text size="sm">La cola del POS o de su adaptador es independiente del modo sin conexión del navegador de PF. Conserva origen e ID de venta al reintentar; prueba cada sistema por separado.</Text>
          {plan.sources.length > 0 && <div><Text size="sm" fw={600} mb="xs">Documentación del proveedor</Text><Stack gap="xs">{plan.sources.map(source => <Anchor key={source.url} href={source.url} target="_blank" rel="noreferrer" size="sm">{source.title}</Anchor>)}</Stack></div>}
        </Stack>
      </Accordion.Panel></Accordion.Item>
      <Accordion.Item value="package"><Accordion.Control>Paquete para el instalador</Accordion.Control><Accordion.Panel>
        <Stack gap="lg">
          <Text maw={760}>Incluye requisitos de esta versión, contratos de venta y devolución, ejemplos ficticios y ocho pruebas pendientes con responsables. Es una ficha de preparación; el instalador debe completar y comprobar la conexión.</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {values.vendor === "other" && <TextInput label="Nombre del sistema POS" description="Nombre comercial; no incluyas claves ni datos de clientes." maxLength={100} value={values.name} onChange={event => update("name", event.currentTarget.value)} disabled={disabled} />}
            <TextInput label="Versión exacta del POS" description="Confírmala en tu caja o con el proveedor antes de descargar." maxLength={100} value={values.version} onChange={event => update("version", event.currentTarget.value)} disabled={disabled} />
            {values.vendor === "other" && <Select label="Dónde funciona" data={installationDeployments.filter(option => !["online", "odoo_sh"].includes(option.value))} value={values.deployment} onChange={value => update("deployment", value)} allowDeselect={false} disabled={disabled} />}
          </SimpleGrid>
          <Text size="sm">{plan.versionNote}</Text>
          {plan.addon && <Alert color="blue" title="Módulo instalable para Odoo 18.0">
            <Stack gap="sm"><Text size="sm">Incluye el código, instrucciones y pruebas del conector {plan.addon.version}. Requiere administrador de Odoo.sh o servidor propio. Las devoluciones parciales necesitan revisión en PF. La descarga y la instalación no activan envíos.</Text>
              <Button component="a" href={plan.addon.downloadUrl} download variant="outline" w="fit-content" disabled={disabled}>Descargar módulo Odoo 18.0 (.zip)</Button>
            </Stack>
          </Alert>}
          <Group><Button variant="outline" disabled={disabled} onClick={() => download("txt")}>Descargar ficha de instalación</Button><Button variant="default" disabled={disabled} onClick={() => download("json")}>Descargar paquete JSON</Button></Group>
          {error && <Alert color="red" role="alert" title="Revisa los datos del paquete">{error}</Alert>}
          {notice && <Text role="status" size="sm">{notice}</Text>}
          <Text size="sm" c="dimmed">La descarga contiene la plantilla de configuración pausada y los ejemplos de PF, sin claves ni datos del negocio. No guarda avances en el servidor. Registra evidencias y responsables en Mi piloto cuando hagas las pruebas.</Text>
          <Title order={3}>Comprueba un ejemplo del adaptador</Title>
          <Text size="sm" maw={760}>Pega una venta ficticia ya convertida al formato PF. Esta revisión ocurre solo en este navegador; no comprueba clientes ni duplicados. El ejemplo que pegues no se incluye en la descarga.</Text>
          <Textarea label="Venta ficticia en formato PF" description="No pegues credenciales ni datos reales. Admite una venta, hasta 20,000 caracteres." value={fixture} onChange={event => { setFixture(event.currentTarget.value); setFixtureDirty(true); setValidation(null); }} rows={10} maxLength={20000} disabled={disabled} spellCheck={false} />
          <Button variant="default" w="fit-content" disabled={disabled} onClick={() => setValidation(validateInstallationFixture(fixture,merchantRegion()))}>Comprobar formato local</Button>
          {validation && <Alert color={validation.valid ? "teal" : "yellow"} role={validation.valid ? "status" : "alert"} title={validation.valid ? "Estructura de la muestra revisada" : "Corrige la muestra"}>{validation.message}</Alert>}
        </Stack>
      </Accordion.Panel></Accordion.Item>
    </Accordion>
  </Stack></section>;
}
