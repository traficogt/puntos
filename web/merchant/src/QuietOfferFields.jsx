import { Alert, Select, Stack, Text } from '@mantine/core';
export default function QuietOfferFields({ form, disabled }) {
  return <Stack gap="md">
    <Alert color="blue" title="Una invitación breve para este momento"><Text size="sm">Guarda la audiencia, el bono y su límite. Después de revisar la comprobación previa, podrás activarla durante 30 a 240 minutos. El reloj empieza al activar.</Text><Text size="sm" mt="xs">Todos los participantes reciben la misma oportunidad, sujeta al presupuesto. Los resultados describen lo ocurrido; no comparan con un grupo sin oferta.</Text></Alert>
    <Select label="Minutos de vigencia desde la activación" allowDeselect={false} data={[30,60,90,120,180,240].map(value=>({value:String(value),label:`${value} minutos`}))} disabled={disabled} {...form.getInputProps('duration_minutes')} />
  </Stack>;
}
