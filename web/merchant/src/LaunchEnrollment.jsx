import {useState} from 'react';
import {Alert,Anchor,Button,Group,Stack,Text,TextInput,Title} from '@mantine/core';
import {isDemo} from './api.js';
import {Failure,Loading} from './ui.jsx';
function enrollmentUrl(data, staff) {
  try {
    if (isDemo) return data?.registration_url || "";
    const url = new URL(data.registration_url);
    if (
      data.business?.id !== staff.business_id ||
      !data.business?.slug ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/registro/${encodeURIComponent(data.business.slug)}`
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}
export default function LaunchEnrollment({invite,staff,onRefresh}){
 const [copied,setCopied]=useState(''),[qrError,setQrError]=useState(false),url=enrollmentUrl(invite.data,staff);
 async function copy(){try{await navigator.clipboard.writeText(url);setCopied('Enlace copiado.');}catch{setCopied('Selecciona el enlace y cópialo manualmente.');}}
 return (        <section className="enrollment" style={{ alignSelf: "start" }}>
          <Title order={2}>
            {isDemo ? "QR de demostración" : "El QR de tu negocio"}
          </Title>
          {isDemo && (
            <Text size="sm" mt="sm">
              Este QR abre la vista previa. No inscribe clientes.
            </Text>
          )}
          <Text size="sm" mt="sm" mb="lg">
            {isDemo ? "En tu cuenta real, aquí encontrarás el QR y el enlace de inscripción de tu negocio." : "Colócalo en caja. Lleva al registro de tu negocio; después de verificar su cuenta, el cliente puede guardar su tarjeta en Wallet."}
          </Text>
          {invite.loading ? (
            <Loading label="Preparando tu enlace…" />
          ) : invite.error || !url ? (
            <Failure
              error={invite.error}
              retry={() => onRefresh()}
            />
          ) : (
            <Stack align="start">
              {qrError ? (
                <Alert color="yellow">
                  No se pudo mostrar el QR. Puedes usar el enlace o volver a
                  cargarlo.
                </Alert>
              ) : (
                <img
                  src={
                    isDemo
                      ? "/merchant-demo-qr.svg"
                      : "/api/admin/customer-enrollment/qr.svg"
                  }
                  alt={`QR de inscripción de ${invite.data.business.name}`}
                  width="224"
                  height="224"
                  onError={() => setQrError(true)}
                />
              )}
              <TextInput
                label="Enlace de inscripción"
                readOnly
                value={url}
                w="100%"
                onFocus={(event) => event.target.select()}
              />
              <Group>
                <Button onClick={copy}>Copiar enlace</Button>
                <Button
                  component="a"
                  href={
                    isDemo
                      ? "/merchant-demo-qr.svg"
                      : "/api/admin/customer-enrollment/qr.svg?download=1"
                  }
                  variant="default"
                  download
                >
                  Descargar QR
                </Button>
              </Group>
              {qrError && (
                <Button variant="subtle" onClick={() => setQrError(false)}>
                  Recargar QR
                </Button>
              )}
              <Text size="sm" role="status">
                {copied}
              </Text>
              <Anchor href={url} target="_blank" rel="noopener noreferrer">
                Ver la inscripción de mis clientes
              </Anchor>
              <Text size="xs" c="dimmed">
                La entrega de códigos de verificación requiere que el canal de
                mensajería del negocio esté conectado. Confírmalo en la prueba
                antes de publicar el QR.
              </Text>
            </Stack>
          )}
        </section>);
}
