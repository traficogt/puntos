import {sendProviderJson,providerReceipt} from './http-provider.js';
export function createBaileysProvider({ config, fetchImpl = fetch }) {
  return {
    name: "baileys",
    canSend({ destinations }) {
      return Boolean(destinations?.phone && (config.BAILEYS_SEND_URL || config.BAILEYS_BASE_URL));
    },
    async send({ destinations, body }) {
      const url = String(config.BAILEYS_SEND_URL || "").trim()
        || new URL("/send-message", config.BAILEYS_BASE_URL).toString();
      const data = await sendProviderJson({
        url,fetchImpl,timeoutMs:config.MESSAGE_PROVIDER_TIMEOUT_MS,
        headers:config.BAILEYS_API_KEY ? {Authorization:`Bearer ${config.BAILEYS_API_KEY}`} : {},
        payload:{to:destinations.phone,body,text:body}
      });
      return {ok:true,providerId:providerReceipt('baileys',data?.id ?? data?.messageId)};
    }
  };
}
