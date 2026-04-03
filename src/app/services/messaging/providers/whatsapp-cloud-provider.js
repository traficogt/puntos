export function createWhatsAppCloudProvider({ config, fetchImpl = fetch }) {
  return {
    name: "whatsapp_cloud",
    canSend({ destinations }) {
      return Boolean(destinations?.phone && config.WA_PHONE_NUMBER_ID && config.WA_ACCESS_TOKEN);
    },
    async send({ destinations, body }) {
      const apiVersion = String(config.WA_API_VERSION || "v21.0").trim() || "v21.0";
      const url = `https://graph.facebook.com/${apiVersion}/${config.WA_PHONE_NUMBER_ID}/messages`;
      const resp = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destinations.phone,
          type: "text",
          text: { body }
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(JSON.stringify(data));
      return { ok: true, providerId: data?.messages?.[0]?.id ?? "whatsapp_cloud" };
    }
  };
}
