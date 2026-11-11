import { logger } from "../../../../utils/logger.js";

export function createDevProvider({ environment = process.env.NODE_ENV || "production" } = {}) {
  return {
    name: "dev",
    canSend() {
      return environment !== "production";
    },
    async send(message) {
      if (environment === "production") throw new Error("Development messaging is disabled in production");
      logger.info({ channel: message.channel }, "[MESSAGE dev] simulated delivery");
      return { ok: true, providerId: "dev" };
    }
  };
}
