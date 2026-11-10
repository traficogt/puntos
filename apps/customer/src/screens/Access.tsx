import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../context";
import { Button, Copy, Heading, Notice, Screen, layout } from "../components";
import { fonts } from "../theme";
import { businessSlug, type Business, type Customer } from "../model";
import { demo } from "../demo";
export function Access() {
  const { api, controller, colors, state } = useApp();
  const params = useLocalSearchParams<{ business?: string }>();
  const [business, setBusiness] = useState<Business | null>(null),
    [entry, setEntry] = useState(""),
    [phone, setPhone] = useState("+502"),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [stage, setStage] = useState<"entry" | "phone" | "code">("entry"),
    [mode, setMode] = useState<"login" | "join">("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deadline, setDeadline] = useState(0),
    [now, setNow] = useState(() => Date.now());
  const generation = useRef(0),
    alive = useRef(true),
    busyRef = useRef(false);
  const invalidateRequests = useCallback(() => {
    generation.current++;
    busyRef.current = false;
  }, []);
  useEffect(() => {
    alive.current = true;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      invalidateRequests();
      clearInterval(id);
    };
  }, [invalidateRequests]);
  const back = useCallback(() => {
    invalidateRequests();
    setBusy(false);
    setError("");
    setCode("");
    setStage(stage === "code" ? "phone" : "entry");
  }, [stage, invalidateRequests]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stage === "entry") return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [stage, back]);
  const find = useCallback(
    async (input: string) => {
      if (busyRef.current || !alive.current) return;
      busyRef.current = true;
      const gen = ++generation.current;
      setError("");
      setBusy(true);
      try {
        const slug = businessSlug(input);
        const found = await api.request<Business>(`/business/${slug}`);
        if (alive.current && gen === generation.current) {
          setBusiness(found);
          setStage("phone");
        }
      } catch (e) {
        if (alive.current && gen === generation.current)
          setError((e as Error).message);
      } finally {
        if (alive.current && gen === generation.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [api],
  );
  useEffect(() => {
    const receive = (url: string | null) => {
      if (url?.startsWith("puntosfieles://negocio/")) void find(url);
    };
    void Linking.getInitialURL().then(receive);
    const sub = Linking.addEventListener("url", ({ url }) => receive(url));
    return () => sub.remove();
  }, [find]);
  useEffect(() => {
    if (typeof params.business === "string") {
      const business = params.business;
      queueMicrotask(() => void find(business));
    }
  }, [params.business, find]);
  async function requestCode() {
    if (!business || busyRef.current) return;
    const normalized = phone.replace(/[\s()-]/g, "");
    if (!/^\+\d{8,15}$/.test(normalized)) {
      setError(
        "Incluye el código de país y tu número. Por ejemplo: +502 5555 5555.",
      );
      return;
    }
    if (mode === "join" && name.trim().length < 2) {
      setError("Escribe tu nombre para crear tu tarjeta.");
      return;
    }
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await api.request(`/business/${business.slug}/${mode}/request-code`, {
        method: "POST",
        body: {
          phone: normalized,
          ...(mode === "join" ? { name: name.trim() } : {}),
        },
      });
      if (alive.current && gen === generation.current) {
        setPhone(normalized);
        setStage("code");
        setDeadline(Date.now() + 60000);
        setCode("");
      }
    } catch (e) {
      if (alive.current && gen === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && gen === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function verify() {
    if (!business || busyRef.current) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Escribe los 6 dígitos del código.");
      return;
    }
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const out = await api.request<{
        token: string;
        expiresAt: string;
        customer: Customer;
        business: Business;
      }>(`/business/${business.slug}/${mode}/verify`, {
        method: "POST",
        body: {
          phone,
          code,
          ...(mode === "join" ? { name: name.trim() } : {}),
        },
      });
      if (!alive.current || gen !== generation.current) return;
      await controller.activate(
        {
          token: out.token,
          expiresAt: out.expiresAt,
          customerId: out.customer.id,
          businessId: out.business.id,
          slug: out.business.slug,
        },
        { isCurrent: () => alive.current && gen === generation.current },
      );
      void controller.refresh();
    } catch (e) {
      if (alive.current && gen === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && gen === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const inputStyle = {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
    backgroundColor: colors.surface,
  };
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Screen>
          <View style={[layout.row, { marginBottom: 48, marginTop: 10 }]}>
            <Image
              source={require("../../assets/pf-logo.png")}
              style={{ width: 36, height: 36 }}
            />
            <Copy style={{ fontFamily: fonts.brand, fontSize: 22 }}>
              PuntosFieles.
            </Copy>
          </View>
          {stage !== "entry" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver"
              onPress={back}
              style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
                marginBottom: 20,
              }}
            >
              <Ionicons name="chevron-back" size={21} color={colors.primary} />
              <Copy style={{ color: colors.primary }}>Volver</Copy>
            </Pressable>
          )}
          {stage === "entry" ? (
            <>
              <Heading>
                Tus lugares favoritos.{`\n`}Más razones para volver.
              </Heading>
              <Copy
                style={{ color: colors.muted, marginTop: 8, marginBottom: 36 }}
              >
                Una tarjeta, tus puntos y la próxima recompensa. Todo a la mano.
              </Copy>
              <Copy style={{ fontFamily: fonts.medium, marginBottom: 10 }}>
                Enlace o código de tu negocio
              </Copy>
              <TextInput
                editable={!busy}
                accessibilityLabel="Enlace o código del negocio"
                value={entry}
                onChangeText={setEntry}
                placeholder="Ej. cafe-bourbon"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="URL"
                style={inputStyle}
                onSubmitEditing={() => void find(entry)}
              />
              <Notice>
                Lo encuentras junto al QR de registro del negocio.
              </Notice>
              <Button
                label="Encontrar mi negocio"
                loading={busy}
                disabled={!entry.trim()}
                onPress={() => void find(entry)}
              />
              <View style={{ marginTop: 40 }}>
                <Button
                  label="Explorar una tarjeta de ejemplo"
                  secondary
                  icon="eye-outline"
                  onPress={() => void controller.preview(demo)}
                />
                <Notice>
                  Recorre la app con datos de muestra, sin crear una cuenta.
                </Notice>
              </View>
            </>
          ) : stage === "phone" ? (
            <>
              <Heading>
                {mode === "join"
                  ? "Tu próxima recompensa empieza aquí."
                  : "Qué gusto verte de nuevo."}
              </Heading>
              <Copy style={{ color: colors.muted, marginBottom: 28 }}>
                {business?.name} ·{" "}
                {mode === "join"
                  ? "Crea tu tarjeta con tu teléfono."
                  : "Ingresa con el teléfono de tu tarjeta."}
              </Copy>
              {mode === "join" && (
                <View style={{ marginBottom: 20 }}>
                  <Copy style={{ marginBottom: 8 }}>Tu nombre</Copy>
                  <TextInput
                    editable={!busy}
                    accessibilityLabel="Tu nombre"
                    value={name}
                    onChangeText={setName}
                    style={inputStyle}
                    placeholder="¿Cómo te llamas?"
                    placeholderTextColor={colors.muted}
                    autoComplete="given-name"
                    maxLength={120}
                  />
                </View>
              )}
              <Copy style={{ marginBottom: 8 }}>Teléfono</Copy>
              <TextInput
                editable={!busy}
                accessibilityLabel="Teléfono"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                style={inputStyle}
                maxLength={25}
              />
              <Notice>
                Te enviaremos un código para confirmar que eres tú.
              </Notice>
              <Button
                label="Enviarme un código"
                loading={busy}
                onPress={() => void requestCode()}
              />
              <View style={{ marginTop: 16 }}>
                <Button
                  label={
                    mode === "login"
                      ? "Soy nuevo, crear mi tarjeta"
                      : "Ya tengo una tarjeta"
                  }
                  secondary
                  disabled={busy}
                  onPress={() => {
                    setMode(mode === "login" ? "join" : "login");
                    setError("");
                  }}
                />
              </View>
              <Notice>
                Al continuar aceptas los términos y el aviso de privacidad de
                PF.
              </Notice>
              <View style={layout.row}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    void Linking.openURL(
                      "https://puntosfieles.com/terminos.html",
                    )
                  }
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Copy style={{ color: colors.primary, fontSize: 14 }}>
                    Términos
                  </Copy>
                </Pressable>
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    void Linking.openURL(
                      "https://puntosfieles.com/privacidad.html",
                    )
                  }
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Copy style={{ color: colors.primary, fontSize: 14 }}>
                    Privacidad
                  </Copy>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Heading>Un código y estás dentro.</Heading>
              <Copy style={{ color: colors.muted, marginBottom: 28 }}>
                Escribe el código que enviamos a {phone}.
              </Copy>
              <Copy style={{ marginBottom: 8 }}>Código de 6 dígitos</Copy>
              <TextInput
                editable={!busy}
                accessibilityLabel="Código de 6 dígitos"
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                style={[
                  inputStyle,
                  {
                    fontSize: 28,
                    letterSpacing: 8,
                    textAlign: "center",
                    marginBottom: 24,
                  },
                ]}
                onSubmitEditing={() => void verify()}
              />
              <Button
                label="Abrir mi tarjeta"
                loading={busy}
                onPress={() => void verify()}
              />
              <View style={{ marginTop: 16 }}>
                <Button
                  label={
                    remaining ? `Reenviar en ${remaining} s` : "Reenviar código"
                  }
                  secondary
                  disabled={remaining > 0 || busy}
                  onPress={() => void requestCode()}
                />
              </View>
            </>
          )}
          {(error || state.error) && (
            <Notice error>{error || state.error}</Notice>
          )}
          <View style={{ flex: 1, minHeight: 28 }} />
          <Copy
            style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}
          >
            Tus puntos pertenecen al programa de cada negocio.
          </Copy>
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
