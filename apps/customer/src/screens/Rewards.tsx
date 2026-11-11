import React from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useClock } from "../use-clock";
import { useApp } from "../context";
import { Copy, Notice } from "../components";
import { NativeButton, NativeScreen, SnapshotPending } from "../native-components";
import { fonts } from "../theme";
import { rewardState } from "../model";

export function Rewards() {
  const { state, colors } = useApp();
  const nav = useRouter();
  const data = state.snapshot;
  const now = useClock(30000);
  const rewards =
    data?.business.features?.rewards === false ? [] : data?.rewards || [];
  if (!data) return <NativeScreen refresh><SnapshotPending /></NativeScreen>;
  return (
    <NativeScreen refresh>
      {data && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            paddingBottom: 16,
          }}
        >
          <Copy style={{ color: colors.muted, fontSize: 15 }}>Tus puntos</Copy>
          <Copy
            style={{
              fontFamily: fonts.bold,
              fontSize: 20,
              lineHeight: 27,
              fontVariant: ["tabular-nums"],
            }}
          >
            {data.customer.points.toLocaleString("es-GT")}
          </Copy>
        </View>
      )}
      {!rewards.length ? (
        <View style={{ paddingVertical: 36, alignItems: "center" }}>
          <Ionicons name="gift-outline" color={colors.muted} size={36} />
          <Copy
            accessibilityRole="header"
            style={{
              fontFamily: fonts.brand,
              fontSize: 22,
              lineHeight: 28,
              marginTop: 16,
              textAlign: "center",
            }}
          >
            Aún no hay recompensas
          </Copy>
          <Copy
            style={{
              color: colors.muted,
              marginTop: 10,
              textAlign: "center",
              fontSize: 15,
              lineHeight: 23,
            }}
          >
            {data?.business.features?.rewards === false
              ? "Este programa todavía no tiene recompensas habilitadas."
              : "Aquí aparecerán las recompensas de tu negocio."}
          </Copy>
        </View>
      ) : (
        <>
          <Copy
            style={{
              color: colors.muted,
              fontSize: 14,
              lineHeight: 21,
              marginBottom: 20,
            }}
          >
            Pide tu recompensa en caja y muestra tu QR al equipo del negocio.
          </Copy>
          {rewards.map((reward) => {
            const availability = rewardState(
              reward,
              data!.customer.points,
              state.offline || !state.fresh,
              now,
            );
            return (
              <View
                key={reward.id}
                style={{
                  paddingVertical: 18,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <Ionicons
                    name={
                      availability.available
                        ? "gift-outline"
                        : "lock-closed-outline"
                    }
                    color={
                      availability.available ? colors.primary : colors.muted
                    }
                    size={23}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Copy
                      accessibilityRole="header"
                      style={{
                        fontFamily: fonts.bold,
                        fontSize: 17,
                        lineHeight: 24,
                      }}
                    >
                      {reward.name}
                    </Copy>
                    <Copy
                      style={{
                        fontFamily: fonts.medium,
                        color: colors.primary,
                        marginTop: 4,
                        fontSize: 14,
                        lineHeight: 21,
                      }}
                    >
                      {reward.points_cost.toLocaleString("es-GT")} puntos
                    </Copy>
                    {reward.description && (
                      <Copy
                        style={{
                          color: colors.muted,
                          marginTop: 8,
                          fontSize: 14,
                          lineHeight: 21,
                        }}
                      >
                        {reward.description}
                      </Copy>
                    )}
                    <Copy
                      style={{
                        color: availability.available
                          ? colors.success
                          : colors.muted,
                        fontFamily: fonts.medium,
                        fontSize: 13,
                        lineHeight: 20,
                        marginTop: 10,
                      }}
                    >
                      {availability.label}
                    </Copy>
                    {!!reward.branch_labels?.length && (
                      <Copy
                        style={{
                          color: colors.muted,
                          fontSize: 13,
                          lineHeight: 20,
                          marginTop: 6,
                        }}
                      >
                        En: {reward.branch_labels.join(", ")}
                      </Copy>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
          <View style={{ marginTop: 12 }}>
            <NativeButton
              label={state.demo ? "Conoce tu QR de cliente" : "Mostrar mi QR"}
              icon="qr-code-outline"
              disabled={state.offline}
              onPress={() => nav.push("/qr")}
            />
          </View>
        </>
      )}
      {state.demo && (
        <Notice>
          Las recompensas y condiciones de este ejemplo son ilustrativas.
        </Notice>
      )}
      {state.error && <Notice error>{state.error}</Notice>}
    </NativeScreen>
  );
}
