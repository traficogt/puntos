import React from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useClock } from "../use-clock";
import { useApp } from "../context";
import { Copy, Heading, Notice, Screen, layout } from "../components";
import { fonts } from "../theme";
import { rewardState } from "../model";
export function Rewards() {
  const { state, colors } = useApp();
  const data = state.snapshot;
  const now = useClock(30000);
  return (
    <Screen refresh>
      <Heading>Volver se disfruta.</Heading>
      <Copy style={{ color: colors.muted, marginBottom: 30 }}>
        Elige tu próxima recompensa. Pídela al equipo del negocio mostrando tu
        tarjeta.
      </Copy>
      {!data?.rewards.length ? (
        <View style={{ paddingVertical: 40 }}>
          <Ionicons name="gift-outline" color={colors.muted} size={40} />
          <Copy
            style={{ fontFamily: fonts.brand, fontSize: 22, marginTop: 20 }}
          >
            Lo bueno está por venir.
          </Copy>
          <Notice>
            {data?.business.features?.rewards === false
              ? "Este programa todavía no tiene recompensas habilitadas."
              : "Aquí aparecerán las recompensas de tu negocio."}
          </Notice>
        </View>
      ) : (
        data.rewards.map((reward, index) => {
          const availability = rewardState(
            reward,
            data.customer.points,
            state.offline || !state.fresh,
            now,
          );
          return (
            <View
              key={reward.id}
              style={{
                paddingVertical: 24,
                borderTopWidth: 1,
                borderColor: colors.line,
              }}
            >
              <View style={layout.between}>
                <View style={{ flex: 1 }}>
                  <Copy
                    style={{
                      fontFamily: fonts.brand,
                      fontSize: 23,
                      lineHeight: 29,
                    }}
                  >
                    {reward.name}
                  </Copy>
                  <Copy
                    style={{
                      fontFamily: fonts.bold,
                      color: colors.primary,
                      marginTop: 8,
                    }}
                  >
                    {reward.points_cost.toLocaleString("es-GT")} puntos
                  </Copy>
                </View>
                <Ionicons
                  name={
                    availability.available
                      ? "gift-outline"
                      : "lock-closed-outline"
                  }
                  color={availability.available ? colors.primary : colors.muted}
                  size={25}
                />
              </View>
              {reward.description && (
                <Copy
                  style={{ color: colors.muted, marginTop: 12, fontSize: 15 }}
                >
                  {reward.description}
                </Copy>
              )}
              <Copy
                style={{
                  color: availability.available ? colors.success : colors.muted,
                  fontFamily: fonts.medium,
                  fontSize: 13,
                  marginTop: 14,
                }}
              >
                {availability.label}
              </Copy>
              {!!reward.branch_labels?.length && (
                <Notice>En: {reward.branch_labels.join(", ")}</Notice>
              )}
            </View>
          );
        })
      )}
      {state.demo && (
        <Notice>
          Las recompensas y condiciones de este ejemplo son ilustrativas.
        </Notice>
      )}
      {state.error && <Notice error>{state.error}</Notice>}
    </Screen>
  );
}
