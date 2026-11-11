import {merchantRegion} from './region.js';
import PosInstallation from "./PosInstallation.jsx";
import PosRefunds from "./PosRefunds.jsx";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Divider, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { api, isDemo, useResource } from "./api.js";
import { BusinessLink, Failure, Loading, Locked, money, number } from "./ui.jsx";
import { configurationPayload, connectionModes, connectionSnapshot, connectionValues, receiptFromValues } from "./pos-model.js";

const base = "/api/admin/pos";
const advanced = "/administracion/?configurar=punto-de-venta";

export default function PosConnect({ features, onDirty }) {
  const [refresh, setRefresh] = useState(0);
  const resource = useResource(features.external_awards ? base : null, refresh);
  if (!features.external_awards) return <Locked feature="Conectar caja" />;
  if (resource.loading) return <Loading label="Cargando la conexión de tu caja…" />;
  if (resource.error) return <Failure error={resource.error} retry={() => setRefresh(v => v + 1)} />;
  if (!resource.data) return null;
  try { connectionValues(resource.data.integration); }
  catch (error) { return <Alert color="yellow" title="Revisa la conexión"><Text>{error.message}</Text><BusinessLink href={advanced}>Abrir conexiones en administración</BusinessLink></Alert>; }
  return <Workspace initial={resource.data.integration} onDirty={onDirty} />;
}

function Workspace({ initial, onDirty }) {
  const [integration, setIntegration] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const alive = useRef(true);
  const baseline = useRef(connectionSnapshot(initial));
  const configuration = useForm({ initialValues: connectionValues(initial) });
  const receipt = useForm({ initialValues: {
    saleId: "prueba-001", source: "mi-caja", customerPhone: isDemo ? "55554444" : "", amountQ: 75, items: 2, status: "paid",
  }, onValuesChange: () => { setPreview(null); setError(""); } });
  const [handoffDirty, setHandoffDirty] = useState(false);
  const dirty = configuration.isDirty() || receipt.isDirty() || handoffDirty;
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirty(false); }; }, [onDirty]);
  useEffect(() => onDirty(dirty || !!busy), [dirty, busy, onDirty]);

  async function checkReceipt(event) {
    event.preventDefault();
    if (busy) return;
    setError(""); setErrorScope("preview"); setNotice(""); setPreview(null);
    let sale;
    try { sale = receiptFromValues(receipt.values,merchantRegion()); }
    catch (e) { setError(e.message); return; }
    setBusy("preview");
    try {
      const result = await api(`${base}/preflight`, { method: "POST", body: JSON.stringify(sale) });
      if (!alive.current) return;
      if (result.dryRun !== true || !result.rows?.length) throw new Error("No pudimos confirmar la prueba. Inténtalo de nuevo.");
      setPreview(result); receipt.resetDirty();
    } catch (e) { if (alive.current && e.name !== "AbortError") setError(e.message || "No se pudo comprobar la muestra. Revisa tu conexión e inténtalo de nuevo."); }
    finally { if (alive.current) setBusy(""); }
  }

  function chooseMode(mode) {
    configuration.setValues({ mode, enabled: mode === integration.mode ? integration.enabled : false, automatic: mode === integration.mode ? integration.automatic : false });
    setNotice(""); setError("");
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy("save"); setNotice(""); setError(""); setErrorScope("save");
    try {
      const latest = await api(base);
      if (!alive.current) return;
      if (connectionSnapshot(latest.integration) !== baseline.current)
        throw new Error("La conexión cambió en otra sesión. Recarga la página y revisa los ajustes antes de guardar.");
      const payload = configurationPayload(configuration.values, latest.integration);
      const result = await api(base, { method: "PUT", body: JSON.stringify(payload) });
      if (!alive.current) return;
      const values = connectionValues(result.integration);
      configuration.setValues(values); configuration.setInitialValues(values); configuration.resetDirty(values);
      setIntegration(result.integration); baseline.current = connectionSnapshot(result.integration);
      setNotice(isDemo ? "Demostración: configuración guardada solo en esta pestaña." : values.enabled ? "Conexión habilitada. Completa los pasos de tu método para recibir ventas." : "Conexión guardada y pausada.");
    } catch (e) { if (alive.current && e.name !== "AbortError") setError(e.message || "No se pudo guardar la conexión. Tus ajustes siguen aquí."); }
    finally { if (alive.current) setBusy(""); }
  }
  const row = preview?.rows?.[0];
  const mode = configuration.values.mode;
  return <Stack gap="xl">
    <div><Title order={1}>Conectar caja</Title><Text className="intro">Lleva las compras de tu punto de venta a PF y evita volver a escribir cada importe. Primero comprueba cómo identifica tu caja al cliente.</Text></div>
    <PosInstallation initialMode={initial.mode} selectedMode={mode} onSelectMode={chooseMode} onDirty={setHandoffDirty} disabled={!!busy} />
    <Divider />
    <PosRefunds />
    <Divider />
    <section aria-labelledby="pos-sample-title">
      <Title order={2} id="pos-sample-title" mb="sm">Prueba una venta sin asignar puntos</Title>
      <Text mb="md">Copia los datos de un recibo. PF comprobará el teléfono dentro de este negocio y si el ID ya se procesó. Puedes hacerlo antes de habilitar la conexión.</Text>
      <Alert color="gray" mb="lg" title="El teléfono une la compra con el cliente"><Text size="sm">Debe ser el mismo teléfono registrado en PF. Un nombre, correo, NIT o código de cliente de tu caja no lo sustituye. {merchantRegion().country==='GT'?'Los números de Guatemala con 8 dígitos se completan con 502.':'Usa el número internacional completo, con el código de país.'}</Text></Alert>
      <form onSubmit={checkReceipt}>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="ID de la venta" description="Conserva el mismo ID cuando reintentes una venta." maxLength={200} required disabled={!!busy} {...receipt.getInputProps("saleId")} />
            <TextInput label="Origen de la venta" description="Para detectar repetidas, usa el mismo origen e ID que envía tu caja." maxLength={180} required disabled={!!busy} {...receipt.getInputProps("source")} />
            <TextInput label="Teléfono que aparece en la venta" description={isDemo ? "Dato ficticio: usa 55554444 para ver una coincidencia." : "El cliente debe estar inscrito en este negocio."} type="tel" maxLength={40} required disabled={!!busy} {...receipt.getInputProps("customerPhone")} />
            <NumberInput label={`Importe pagado (${merchantRegion().currency})`} description={`Monto en la moneda del negocio, con ${merchantRegion().minorUnits} decimales.`} min={0} max={99999999.99} decimalScale={merchantRegion().minorUnits} required disabled={!!busy} {...receipt.getInputProps("amountQ")} />
            <NumberInput label="Cantidad de artículos" description="Es necesaria si tu programa suma puntos por artículos." min={0} max={2147483647} allowDecimal={false} required disabled={!!busy} {...receipt.getInputProps("items")} />
            <Select label="Estado del recibo" description="Solo se aceptan ventas pagadas." allowDeselect={false} required disabled={!!busy} data={[{ value: "paid", label: "Pagado" }, { value: "completed", label: "Completado y pagado" }]} {...receipt.getInputProps("status")} />
          </SimpleGrid>
          <Button type="submit" w="fit-content" loading={busy === "preview"} disabled={!!busy}>Comprobar muestra</Button>
        </Stack>
      </form>
      {error && errorScope === "preview" && <Alert color="red" mt="md" role="alert" title="No se pudo comprobar la muestra">{error}</Alert>}
      {row && <Alert mt="lg" color={row.status === "ready" ? "teal" : row.status === "duplicate" ? "gray" : "yellow"} title={row.status === "ready" ? "Muestra válida · cliente encontrado" : row.status === "duplicate" ? "Esta venta ya fue procesada" : "La muestra necesita una corrección"} role="status">
        <Stack gap="xs"><Text size="sm">{row.message}</Text>
          <Text size="sm">Teléfono comprobado: {row.customerPhone || receipt.values.customerPhone} · Importe: {money(row.amountQ)}</Text>
          {row.status === "ready" && <Text size="sm"><strong>{number(row.points)} puntos estimados{isDemo ? " de ejemplo" : " con las reglas actuales"}.</strong> Los beneficios aplicables al procesar la venta pueden cambiar el resultado final.</Text>}
          <Text size="sm">No se guardó una compra ni se asignaron puntos. Esta prueba comprueba los datos en PF; aún debes verificar el envío desde tu caja.</Text>
          {row.code === "SALE_404" && <BusinessLink href="/administracion/?configurar=puntos">Revisar la inscripción del cliente</BusinessLink>}
        </Stack>
      </Alert>}
      <Text size="sm" c="dimmed" mt="md">Para CSV, revisa también las columnas del archivo en administración. En Loyverse, verifica la cuenta y consulta la vista previa de recibos; esta muestra no prueba esa conexión.</Text>
    </section>
    <Divider />
    <section aria-labelledby="pos-configuration-title">
      <Group justify="space-between" mb="md"><Title order={2} id="pos-configuration-title">Configura la conexión</Title><Badge color={integration.enabled ? "teal" : "gray"} variant="light">{integration.enabled ? "Habilitada" : "Pausada"}</Badge></Group>
      <form onSubmit={save}><Stack gap="md">
        <Select label="Método que guardará PF" value={mode} onChange={v => chooseMode(v || "api")} allowDeselect={false} data={connectionModes} disabled={!!busy} maw={500} />
        {mode === "loyverse" ? <Text size="sm">{integration.loyverse?.configured ? `Cuenta verificada${integration.loyverse.merchant_name ? `: ${integration.loyverse.merchant_name}` : ""}.` : "Conecta tu cuenta de Loyverse desde administración. Allí se verifican el acceso y la moneda antes de guardar las credenciales."}</Text> : mode === "api" ? <Text size="sm">Tu proveedor necesita adaptar las ventas al formato de PF. La dirección de envío, el ejemplo JSON y la gestión de la clave están en administración.</Text> : <Text size="sm">Importar CSV requiere una revisión y confirmación por lote. Habilitar este método no importa archivos automáticamente.</Text>}
        <Checkbox label="Habilitar esta conexión para recibir o importar ventas" description="Guardar con esta opción activa permite que el método elegido asigne puntos al procesar ventas válidas." disabled={!!busy || (mode === "loyverse" && !integration.loyverse?.configured)} {...configuration.getInputProps("enabled", { type: "checkbox" })} />
        {mode === "loyverse" && <Checkbox label="Sincronizar nuevas ventas automáticamente" description="Con la conexión habilitada, las ventas pagadas posteriores a su activación pueden sumar puntos sin una confirmación por venta." disabled={!!busy || !integration.loyverse?.configured} {...configuration.getInputProps("automatic", { type: "checkbox" })} />}
        <Group><Button type="submit" loading={busy === "save"} disabled={!!busy || !configuration.isDirty()}>Guardar conexión</Button><Button variant="subtle" disabled={!!busy || !configuration.isDirty()} onClick={() => { configuration.reset(); setError(""); setNotice(""); }}>Descartar ajustes</Button></Group>
      </Stack></form>
      <Stack gap="sm" mt="lg">
        <BusinessLink href={advanced}>{mode === "loyverse" ? "Verificar cuenta y revisar recibos de Loyverse" : mode === "csv" ? "Seleccionar columnas y revisar archivo CSV" : "Ver instrucciones para el proveedor y gestionar la clave"}</BusinessLink>
        <Text size="sm" c="dimmed">Las claves y los permisos de lectura se administran dentro de tu cuenta real. El equipo de caja no necesita verlos.</Text>
      </Stack>
    </section>
    {error && errorScope === "save" && <Alert color="red" role="alert" title="No se pudo guardar la conexión">{error}</Alert>}
    {notice && <Alert color="teal" role="status">{notice}</Alert>}
  </Stack>;
}
