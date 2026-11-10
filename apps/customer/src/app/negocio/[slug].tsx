import React from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useApp } from "../../context";
import { Button, Heading, Notice, Screen } from "../../components";
import { businessSlug } from "../../model";
export default function BusinessLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { state, controller } = useApp();
  const router = useRouter();
  let valid = "";
  try {
    valid = businessSlug(slug || "");
  } catch {}
  if (!valid)
    return (
      <Screen>
        <Heading>Enlace no válido.</Heading>
        <Notice>Pide el enlace de registro al negocio.</Notice>
        <Button
          label="Volver a mi tarjeta"
          onPress={() => router.replace("/")}
        />
      </Screen>
    );
  if (!state.session && !state.demo)
    return <Redirect href={{ pathname: "/", params: { business: valid } }} />;
  return (
    <Screen>
      <Heading>¿Cambiar de negocio?</Heading>
      <Notice>
        Se cerrará tu sesión actual. Tus puntos seguirán en la cuenta de cada
        negocio.
      </Notice>
      <Button
        label="Cerrar sesión y continuar"
        onPress={() =>
          void controller
            .signOut()
            .then(() =>
              router.replace({ pathname: "/", params: { business: valid } }),
            )
        }
      />
      <Notice>
        También puedes volver para seguir usando tu tarjeta actual.
      </Notice>
      <Button
        secondary
        label="Mantener mi tarjeta"
        onPress={() => router.replace("/(tabs)/card")}
      />
    </Screen>
  );
}
