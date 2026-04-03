function encodeForm(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function createTwilioProvider({ config, fetchImpl = fetch }) {
  return {
    name: "twilio",
    canSend({ destinations }) {
      return Boolean(destinations?.phone && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_WHATSAPP_FROM);
    },
    async send({ destinations, body }) {
      const sid = String(config.TWILIO_ACCOUNT_SID || "").trim();
      const token = String(config.TWILIO_AUTH_TOKEN || "").trim();
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const resp = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: encodeForm({
          To: `whatsapp:${destinations.phone}`,
          From: String(config.TWILIO_WHATSAPP_FROM || "").startsWith("whatsapp:")
            ? config.TWILIO_WHATSAPP_FROM
            : `whatsapp:${config.TWILIO_WHATSAPP_FROM}`,
          Body: body
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(JSON.stringify(data));
      return { ok: true, providerId: data?.sid ?? "twilio" };
    }
  };
}
