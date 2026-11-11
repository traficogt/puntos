import type { PushNative } from "./push";
export const pushNative: PushNative = {
  supported: false,
  permission: async () => "denied",
  requestPermission: async () => "denied",
  token: async () => "",
  clear: async () => {},
  createInstallation: async () => {
    throw new Error("Native notifications unavailable");
  },
  hash: async () => "",
};
export type PushEvents = {
  token: (token: string) => void;
  received: (data: unknown) => void;
  opened: (data: unknown) => void;
  matches: (data: unknown) => boolean;
};
export function listenForPush(_events: PushEvents): () => void {
  return () => {};
}
export async function openNotificationSettings() {}
