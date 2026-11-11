import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Anchor, Badge, Button, ColorInput, FileInput, Group, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { api, isDemo } from "./api.js";
import { BusinessLink, Failure, Loading } from "./ui.jsx";
import { brandedQrPath, qrEnrollmentUrl, qrSourceEnrollmentUrl, validateQrForeground } from "./branded-qr-model.js";
import { demoBrandedQrConfiguration, demoBrandedQrSvg } from "./demo-branded-qr.js";
import { prepareLogoFile, verifyQrSvg } from "./qr-logo.js";
import "./branded-qr.css";

export default function BrandedQr({ features, staff }) {
  if (staff?.role !== "OWNER") {
    return <Stack gap="md"><Title order={1}>QR con tu marca</Title><Text>El dueño del negocio puede preparar y descargar este QR.</Text></Stack>;
  }
  if (features?.branded_qr !== true) {
    return (
      <Stack gap="md">
        <Title order={1}>QR con tu marca</Title>
        <Text>Incluye el logotipo dentro del QR, el nombre y los colores de tu negocio en un cartel listo para imprimir.</Text>
        <Text fw={600}>Disponible en los planes Negocio y Empresa.</Text>
        <Text>Tu QR de inscripción estándar sigue disponible en Primeros pasos.</Text>
        <Group><Button size="md" mih={44} component="a" href="#preparar">Ver mi QR estándar</Button><BusinessLink href="/administracion/?seccion=plan">Revisar mi plan</BusinessLink></Group>
      </Stack>
    );
  }
  return <BrandedQrEditor staff={staff} />;
}

function BrandedQrEditor({ staff }) {
  const [refresh, setRefresh] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [logoPosition, setLogoPosition] = useState("center");
  const [upload, setUpload] = useState({ file: null, dataUrl: undefined, loading: false, error: "" });
  const uploadController = useRef(null);
  useEffect(() => {
    setUpload({ file: null, dataUrl: undefined, loading: false, error: "" });
    setLogoPosition("center");
    setSourceId("");
    return () => uploadController.current?.abort();
  }, [staff.business_id]);
  const [resource, setResource] = useState({ data: null, error: null, loading: true });
  const [color, setColor] = useState("");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [appliedColor, setAppliedColor] = useState("");
  const [preview, setPreview] = useState({ url: "", color: "", error: null, loading: true });
  const [status, setStatus] = useState("");
  const registrationUrl = resource.data ? isDemo ? resource.data.registration_url : qrSourceEnrollmentUrl(resource.data, staff, sourceId) : "";
  const previewKey = JSON.stringify([staff.business_id, sourceId, registrationUrl, appliedColor, logoPosition, upload.dataUrl ?? null]);
  useEffect(() => {
    const controller = new AbortController();
    setResource({ data: null, error: null, loading: true });
    const request = isDemo
      ? Promise.resolve(demoBrandedQrConfiguration())
      : api("/api/admin/customer-enrollment/branded-qr", { signal: controller.signal });
    request.then((data) => {
      if (controller.signal.aborted) return;
      if (!isDemo && !qrEnrollmentUrl(data, staff)) throw new Error("La inscripción no corresponde al negocio de la sesión.");
      setResource({ data, error: null, loading: false });
      setColor(data.defaults.foreground);
      setAppliedColor(data.defaults.foreground);
    }).catch((error) => {
      if (!controller.signal.aborted && error.name !== "AbortError") setResource({ data: null, error, loading: false });
    });
    return () => controller.abort();
  }, [refresh, staff.business_id]);

  useEffect(() => {
    if (!resource.data || !appliedColor) return;
    if (!registrationUrl) { setPreview({ url: "", color: appliedColor, key: previewKey, error: new Error("El origen no corresponde al negocio de la sesión."), loading: false }); return; }
    const controller = new AbortController();
    let objectUrl = "";
    setPreview({ url: "", color: appliedColor, key: previewKey, error: null, loading: true });
    const request = isDemo
      ? Promise.resolve().then(() => ({ raw: demoBrandedQrSvg(appliedColor, { logo_position: logoPosition, logo_data_url: upload.dataUrl, ...(sourceId ? { source_id: sourceId } : {}) }) }))
      : upload.dataUrl
        ? api('/api/admin/customer-enrollment/branded-qr.svg', { method: 'POST', signal: controller.signal, body: JSON.stringify({ foreground: appliedColor, logo_position: logoPosition, logo_data_url: upload.dataUrl, ...(sourceId ? { source_id: sourceId } : {}) }) })
        : api(brandedQrPath(appliedColor, logoPosition, sourceId), { signal: controller.signal });
    request.then(async (data) => {
      if (controller.signal.aborted) return;
      if (typeof data.raw !== "string" || !data.raw.startsWith("<svg")) throw new Error("No se recibió la imagen del QR.");
      await verifyQrSvg(data.raw, registrationUrl, controller.signal);
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([data.raw], { type: "image/svg+xml" }));
      setPreview({ url: objectUrl, color: appliedColor, key: previewKey, error: null, loading: false });
    }).catch((error) => {
      if (!controller.signal.aborted && error.name !== "AbortError") setPreview({ url: "", color: appliedColor, key: previewKey, error, loading: false });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resource.data, appliedColor, logoPosition, upload.dataUrl, previewKey, sourceId, registrationUrl]);

  if (resource.loading || (!isDemo && resource.data && resource.data.business.id !== staff.business_id)) return <Loading label="Preparando la marca de tu negocio…" />;
  if (resource.error) return <Failure error={resource.error} retry={() => setRefresh((value) => value + 1)} />;
  const data = resource.data;
  const invalidColor = validateQrForeground(color);
  const changed = color.toUpperCase() !== appliedColor;
  const ready = preview.url && !preview.loading && !preview.error && !changed && !upload.loading && !upload.error && preview.color === appliedColor && preview.key === previewKey;
  async function chooseLogo(file) {
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    setUpload({ file, dataUrl: undefined, loading: Boolean(file), error: "" });
    if (!file) return;
    try {
      const dataUrl = await prepareLogoFile(file, controller.signal);
      if (!controller.signal.aborted) setUpload({ file, dataUrl, loading: false, error: "" });
    } catch (error) {
      if (!controller.signal.aborted) setUpload({ file, dataUrl: undefined, loading: false, error: error.message });
    }
  }
  function applyColor(event) {
    event.preventDefault();
    if (invalidColor) return;
    setAppliedColor(color.toUpperCase());
    setStatus("Color aplicado a la vista previa.");
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setStatus("Enlace copiado.");
    } catch { setStatus("No se pudo copiar. Selecciona el enlace y cópialo manualmente."); }
  }
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>QR con tu marca</Title>
        <Text className="intro">Tu logotipo dentro del QR, listo para invitar a tus clientes desde el mostrador, la mesa o la entrada.</Text>
      </div>
      {isDemo && <Alert color="yellow" title="Ejemplo de demostración">Este QR abre la demostración de PuntosFieles. No registra clientes ni modifica un negocio real.</Alert>}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl" className="branded-qr-layout">
        <Stack gap="lg">
          <div>
            <Title order={2}>{data.business.name}</Title>
            <Text size="sm" mt="xs">El QR conserva el enlace de inscripción de tu negocio. El nombre y los colores se toman de tu configuración de marca.</Text>
          </div>
          <Stack gap="sm">
            <Select label="Origen de inscripción" description={isDemo ? "La selección es de ejemplo; el QR siempre abre la demostración." : "Selecciona un origen existente para medir nuevas inscripciones desde este cartel."} value={sourceId} onChange={value => setSourceId(value || "")} allowDeselect={false} data={[{value:"",label:"Enlace general, sin origen"},...(data.sources || []).map(source => ({value:source.id,label:source.name}))]} size="md" />
            <Anchor href="#origenes">Crear y revisar orígenes</Anchor>
            <FileInput classNames={{ placeholder: "qr-logo-placeholder" }} placeholder="Seleccionar PNG o JPG" label="Subir logotipo para este cartel" description="PNG o JPG, hasta 2 MB. Este archivo no modifica la marca guardada del negocio." accept="image/png,image/jpeg" clearable clearButtonProps={{ 'aria-label': 'Quitar archivo de logotipo' }} value={upload.file} onChange={chooseLogo} error={upload.error || undefined} size="md" />
            <Select label="Ubicación del logotipo" value={logoPosition} onChange={setLogoPosition} allowDeselect={false} data={[{ value: 'center', label: 'Dentro del QR' }, { value: 'header', label: 'Encima del QR' }, { value: 'none', label: 'Sin logotipo' }]} size="md" />
            {upload.loading && <Text size="sm" role="status">Preparando el logotipo…</Text>}
            {!upload.loading && !upload.error && <Text size="sm">{logoPosition === 'none' ? 'Esta versión no incluye logotipo.' : upload.dataUrl ? 'Se usará el archivo que elegiste.' : data.branding.logo_included ? 'Se usará el logotipo de este negocio.' : 'Sube el archivo de tu logotipo para incluirlo en el QR.'}</Text>}
          </Stack>
          <form onSubmit={applyColor}>
            <Stack gap="sm">
              <ColorInput
                label="Color del QR y del texto"
                description="Un color oscuro sobre blanco ayuda a mantener el contraste del código."
                value={color}
                onChange={(value) => { setColor(value); setStatus(""); }}
                onFocus={() => setColorPickerOpen(true)}
                onClick={() => setColorPickerOpen(true)}
                onBlur={() => setColorPickerOpen(false)}
                onChangeEnd={() => setColorPickerOpen(false)}
                onKeyDown={(event) => { if (event.key === "Escape") setColorPickerOpen(false); }}
                popoverProps={{ opened: colorPickerOpen, onDismiss: () => setColorPickerOpen(false) }}
                format="hex" withEyeDropper={false} closeOnColorSwatchClick
                swatches={[data.defaults.foreground, "#302820", "#204030", "#173B59", "#000000"]}
                swatchesLabel="Colores con contraste suficiente"
                error={invalidColor || undefined}
                size="md"
              />
              <Button type="submit" variant="default" size="md" mih={44} disabled={Boolean(invalidColor) || !changed} w="fit-content">Actualizar vista previa</Button>
              {changed && <Text size="sm">Aplica el color antes de descargar o imprimir.</Text>}
            </Stack>
          </form>
          <div className="branded-qr-details">
            {!upload.dataUrl && <Text size="sm">{data.branding.logo_note}</Text>}
            <BusinessLink href="/administracion/?seccion=marca" display="inline-block" mt="sm">Editar nombre, logotipo y colores</BusinessLink>
          </div>
          <TextInput label={isDemo ? "Enlace de demostración" : "Enlace de inscripción"} value={registrationUrl} readOnly onFocus={(event) => event.target.select()} />
          <Group><Button variant="subtle" size="md" mih={44} onClick={copyLink}>Copiar enlace</Button><Anchor href={registrationUrl} target="_blank" rel="noopener noreferrer">{isDemo ? "Abrir demostración" : "Ver inscripción"}</Anchor></Group>
          <Text size="sm" role="status" aria-live="polite">{status}</Text>
        </Stack>
        <Stack gap="md" className="branded-qr-artifact">
          <Group justify="space-between"><Title order={2}>Vista previa</Title><Badge variant="light">SVG para imprimir</Badge></Group>
          <div className="branded-qr-preview" aria-busy={preview.loading}>
            {preview.loading ? <Loading label="Generando y comprobando la lectura del QR…" /> : preview.error ? <Alert color="red" title="No pudimos preparar el QR" role="alert"><Stack gap="sm"><Text size="sm">{preview.error.status ? "Revisa tu conexión, los permisos de tu cuenta y vuelve a intentar." : preview.error.message}</Text><Button variant="outline" color="red" onClick={() => setRefresh((value) => value + 1)}>Reintentar</Button></Stack></Alert> : (
              <img src={preview.url} alt={`${isDemo ? "Cartel de demostración" : "Cartel de inscripción"} de ${data.business.name}`} width="480" height="680" onError={() => setPreview((value) => ({ ...value, error: new Error("No se pudo mostrar el QR.") }))} />
            )}
          </div>
          <Group grow>
            <Button size="md" mih={44} component="a" href={ready ? preview.url : undefined} download={isDemo ? "qr-demostracion-con-marca.svg" : "qr-registro-con-marca.svg"} disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault(); }}>Descargar SVG</Button>
            <Button size="md" mih={44} variant="default" disabled={!ready} onClick={() => window.print()}>Imprimir cartel</Button>
          </Group>
          {ready && <Text size="sm" role="status">Lectura comprobada: el QR conserva el enlace correcto.</Text>}
          <Text size="sm" c="dimmed">Imprime en fondo blanco y sin recortar los márgenes. Prueba el cartel con la cámara de un teléfono antes de colocarlo en tu negocio.</Text>
          {!isDemo && <Text size="sm" c="dimmed">Antes de publicar el QR, confirma que tus clientes reciben el código de verificación para completar su inscripción.</Text>}
        </Stack>
      </SimpleGrid>
      {preview.url && !preview.error && createPortal(
        <div className="branded-qr-print-sheet" aria-hidden="true"><img className="branded-qr-print" src={preview.url} alt="" width="480" height="680" /></div>,
        document.body,
      )}
    </Stack>
  );
}
