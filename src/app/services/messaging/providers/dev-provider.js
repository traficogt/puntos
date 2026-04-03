import { logger } from "../../../../utils/logger.js";

export function createDevProvider() {
  return {
    name: "dev",
    canSend() {
      return true;
    },
    async send(message) {
      logger.info({ message }, "[MESSAGE dev]");
      return { ok: true, providerId: "dev" };
    }
  };
}
