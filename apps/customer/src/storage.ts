import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "./session";
const memory = new Map<string, string>();
// Browser preview never persists a real account or session to browser storage.
const memoryStore: Storage = {
  get: async (key) => memory.get(key) ?? null,
  set: async (key, value) => {
    memory.set(key, value);
  },
  remove: async (key) => {
    memory.delete(key);
  },
};
export const secureStorage: Storage =
  Platform.OS === "web"
    ? memoryStore
    : {
        get: (key) => SecureStore.getItemAsync(key),
        set: (key, value) =>
          SecureStore.setItemAsync(key, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        remove: (key) => SecureStore.deleteItemAsync(key),
      };
export const snapshotStorage: Storage =
  Platform.OS === "web"
    ? memoryStore
    : {
        get: (key) => AsyncStorage.getItem(key),
        set: (key, value) => AsyncStorage.setItem(key, value),
        remove: (key) => AsyncStorage.removeItem(key),
      };
