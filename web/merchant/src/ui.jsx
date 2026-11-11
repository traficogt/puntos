import { merchantRegion } from './region.js';
import { isDemo } from "./api.js";
import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
export function Loading({ label = "Cargando tu negocio…" }) {
  return (
    <Group role="status" py="xl">
      <Loader size="sm" />
      <Text>{label}</Text>
    </Group>
  );
}
export function Failure({ error, retry }) {
  return (
    <Alert color="red" title="No pudimos cargar esta información" role="alert">
      <Stack gap="sm">
        <Text size="sm">
          {error?.status === 403
            ? "Tu cuenta no tiene acceso a esta sección. Revisa los permisos y el plan del negocio."
            : "Revisa tu conexión e inténtalo de nuevo. Tus datos no se han sustituido por ceros."}
        </Text>
        {retry && (
          <Button variant="default" onClick={retry} w="fit-content">
            Reintentar
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
export function Locked({ feature }) {
  return (
    <Stack py="xl" gap="md">
      <Title order={2}>{feature}</Title>
      <Text>
        Esta función no está incluida en el plan actual de tu negocio.
      </Text>
      <BusinessLink href="/administracion/">Abrir administración</BusinessLink>
    </Stack>
  );
}
export const number = (value) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat(merchantRegion().locale, { maximumFractionDigits: 1 }).format(
        value,
      );
export const money = (value) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat(merchantRegion().locale, {
        style: "currency",
        currency: merchantRegion().currency,
        maximumFractionDigits: merchantRegion().minorUnits,
      }).format(value);
export function periodDate(value, timezone) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function BusinessLink({href,children,...props}) {
  return isDemo ? <Text component="span" aria-disabled="true" title="Disponible al entrar a tu negocio real" {...props}>{children} <Text component="span" size="xs" c="dimmed">(cuenta real)</Text></Text> : <Anchor href={href} {...props}>{children}</Anchor>;
}
