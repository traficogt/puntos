import { config } from "../../../../config/index.js";
import { logger } from "../../../../utils/logger.js";

export function createDevProvider({ environment = config.NODE_ENV } = {}) {
  return {
    name: "dev",
    canSend() {
      return environment !== "production";
    },
    async send(message) {
      if (environment === "production")
        throw new Error("Development messaging is disabled in production");
      logger.info({ channel: message.channel }, "[MESSAGE dev] simulated delivery");
      return { ok: true, providerId: "dev" };
    },
  };
}
