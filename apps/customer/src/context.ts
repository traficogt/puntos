import { createContext, useContext } from "react";
import type { ApiClient } from "./api";
import type { SessionController, State } from "./session";
import type { Palette } from "./theme";
export type Appearance = "system" | "light" | "dark";
export const AppContext = createContext<{
  api: ApiClient;
  controller: SessionController;
  state: State;
  colors: Palette;
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
} | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("App provider missing");
  return value;
}
