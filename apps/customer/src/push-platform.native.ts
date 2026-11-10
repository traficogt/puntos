import { Linking, Platform } from "react-native";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import {
  encodeInstallationSecret,
  type PushNative,
  type PushPermission,
} from "./push";
import type { PushEvents } from "./push-platform";
// This release uses the production APNs service. Simulator/development tokens
// are intentionally excluded rather than sent to the wrong environment.
const supported = Platform.OS === "ios" && Device.isDevice && !__DEV__;
function permission(
  result: Notifications.NotificationPermissionsStatus,
): PushPermission {
  if (
    result.granted ||
    result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    return "granted";
  return result.canAskAgain && result.status !== "denied"
    ? "undetermined"
    : "denied";
}
async function deviceToken() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("APNs registration timeout")),
          20000,
        );
      }),
    ]);
    if (
      result.type !== "ios" ||
      typeof result.data !== "string" ||
      !/^[a-f0-9]{32,512}$/i.test(result.data)
    )
      throw new Error("Invalid APNs token");
    return result.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export const pushNative: PushNative = {
  supported,
  permission: async () => permission(await Notifications.getPermissionsAsync()),
  requestPermission: async () =>
    permission(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    ),
  token: deviceToken,
  clear: async () => {
    if (!supported) return;
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.clearLastNotificationResponseAsync();
  },
  createInstallation: async () => ({
    installationId: Crypto.randomUUID(),
    installationSecret: encodeInstallationSecret(
      await Crypto.getRandomBytesAsync(32),
    ),
  }),
  hash: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
};
export function listenForPush(events: PushEvents) {
  if (!supported) return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const matches = events.matches(n.request.content.data);
      return {
        shouldShowBanner: matches,
        shouldShowList: matches,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  let last: string | undefined;
  const opened = (response: Notifications.NotificationResponse) => {
    if (
      response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER ||
      response.notification.request.identifier === last
    )
      return;
    last = response.notification.request.identifier;
    events.opened(response.notification.request.content.data);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  };
  const token = Notifications.addPushTokenListener((t) => {
    if (t.type === "ios" && typeof t.data === "string") events.token(t.data);
  });
  const received = Notifications.addNotificationReceivedListener((n) =>
    events.received(n.request.content.data),
  );
  const response =
    Notifications.addNotificationResponseReceivedListener(opened);
  const initial = Notifications.getLastNotificationResponse();
  if (initial) opened(initial);
  return () => {
    token.remove();
    received.remove();
    response.remove();
    Notifications.setNotificationHandler(null);
  };
}
export async function openNotificationSettings() {
  await Linking.openSettings();
}
