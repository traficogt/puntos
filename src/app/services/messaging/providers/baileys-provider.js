export function createBaileysProvider({ config, fetchImpl = fetch }) {
  return {
    name: "baileys",
    canSend({ destinations }) {
      return Boolean(destinations?.phone && (config.BAILEYS_SEND_URL || config.BAILEYS_BASE_URL));
    },
    async send({ destinations, body }) {
      const url = String(config.BAILEYS_SEND_URL || "").trim()
        || new URL("/send-message", config.BAILEYS_BASE_URL).toString();
      const resp = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.BAILEYS_API_KEY ? { Authorization: `Bearer ${config.BAILEYS_API_KEY}` } : {})
        },
        body: JSON.stringify({
          to: destinations.phone,
          body,
          text: body
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(JSON.stringify(data));
      return { ok: true, providerId: data?.id ?? data?.messageId ?? "baileys" };
    }
  };
}
