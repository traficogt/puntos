import React from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  type AccessibilityRole,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Copy, Notice, Screen } from "./components";
import { useApp } from "./context";
import { fonts } from "./theme";

type IconName = keyof typeof Ionicons.glyphMap;

export function NativeScreen({
  children,
  refresh = false,
  style,
}: React.PropsWithChildren<{ refresh?: boolean; style?: ViewStyle }>) {
  const insets = useSafeAreaInsets();
  return (
    <Screen
      refresh={refresh}
      style={{
        padding: 20,
        paddingTop: 12,
        paddingBottom: Math.max(28, insets.bottom + 16),
        maxWidth: 640,
        ...style,
      }}
    >
      {children}
    </Screen>
  );
}

export function SectionTitle({ children }: React.PropsWithChildren) {
  return (
    <Copy
      accessibilityRole="header"
      style={{
        fontFamily: fonts.bold,
        fontSize: 16,
        lineHeight: 23,
        marginTop: 24,
        marginBottom: 10,
      }}
    >
      {children}
    </Copy>
  );
}

export function NativeButton({
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  secondary = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  secondary?: boolean;
  destructive?: boolean;
}) {
  const { colors } = useApp();
  const foreground = destructive
    ? colors.error
    : secondary
      ? colors.ink
      : colors.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor:
          secondary || destructive ? colors.surface : colors.primary,
        borderWidth: secondary || destructive ? 1 : 0,
        borderColor: colors.line,
        opacity: disabled || loading ? 0.55 : pressed ? 0.75 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={22} color={foreground} />
      ) : null}
      <Copy
        style={{
          fontFamily: fonts.bold,
          color: foreground,
          textAlign: "center",
          flexShrink: 1,
        }}
      >
        {label}
      </Copy>
    </Pressable>
  );
}

export function SettingsGroup({ children }: React.PropsWithChildren) {
  const { colors } = useApp();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

export function SettingsRow({
  label,
  detail,
  icon,
  onPress,
  selected,
  destructive = false,
  disabled = false,
  last = false,
  external = false,
  role = "button",
}: {
  label: string;
  detail?: string;
  icon: IconName;
  onPress: () => void;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  last?: boolean;
  external?: boolean;
  role?: AccessibilityRole;
}) {
  const { colors } = useApp();
  const foreground = destructive ? colors.error : colors.ink;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{
        disabled,
        ...(selected !== undefined ? { checked: selected } : {}),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 14,
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderColor: colors.line,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={21}
        color={destructive ? colors.error : colors.muted}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy style={{ color: foreground, fontSize: 15, lineHeight: 22 }}>
          {label}
        </Copy>
        {detail && (
          <Copy
            style={{
              color: colors.muted,
              fontSize: 13,
              lineHeight: 19,
              marginTop: 3,
            }}
          >
            {detail}
          </Copy>
        )}
      </View>
      {selected !== undefined ? (
        selected && (
          <Ionicons name="checkmark" size={22} color={colors.primary} />
        )
      ) : (
        <Ionicons
          name={external ? "open-outline" : "chevron-forward"}
          size={18}
          color={colors.muted}
        />
      )}
    </Pressable>
  );
}

export function SnapshotPending() {
  const { state, controller } = useApp();
  return <>
    <Notice error={!!state.error}>
      {state.offline ? "Conéctate para cargar tu información." : state.loading ? "Cargando tu información…" : "No pudimos cargar tus datos. Intenta de nuevo."}
    </Notice>
    {!state.loading && <NativeButton label="Volver a cargar" secondary disabled={state.offline} onPress={() => void controller.refresh()} />}
  </>;
}
