function toChatId(phone) {
  return `${String(phone || "").replace(/\D+/g, "")}@c.us`;
}

export function createWahaProvider({ config, fetchImpl = fetch }) {
  return {
    name: "waha",
    canSend({ destinations }) {
      return Boolean(destinations?.phone && config.WAHA_BASE_URL);
    },
    async send({ destinations, body }) {
      const url = new URL("/api/sendText", config.WAHA_BASE_URL).toString();
      const resp = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.WAHA_API_KEY ? { Authorization: `Bearer ${config.WAHA_API_KEY}` } : {})
        },
        body: JSON.stringify({
          session: config.WAHA_SESSION || "default",
          chatId: toChatId(destinations.phone),
          text: body
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(JSON.stringify(data));
      return { ok: true, providerId: data?.id ?? data?.messageId ?? "waha" };
    }
  };
}
