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
import { Copy, Heading, Notice, Screen, layout } from "../components";
import { NativeButton as Button } from "../native-components";
import { fonts } from "../theme";
import { businessSlug, type Business, type Customer } from "../model";
import { demo } from "../demo";
import { ApiError } from "../api";

type SignedIn = {
  token: string;
  expiresAt: string;
  customer: Customer;
  business: Business;
};
type CardChoice = {
  accessToken: string;
  expiresAt: string;
  cards: Pick<Business, "id" | "name" | "slug">[];
};
type AccessResult =
  | ({ status: "signed_in" } & SignedIn)
  | ({ status: "choose_card" } & CardChoice)
  | { status: "no_cards" };
const phoneProofExpired =
  "Vuelve a verificar tu teléfono para abrir tu tarjeta.";

export function Access() {
  const { api, controller, colors, state } = useApp();
  const params = useLocalSearchParams<{ business?: string }>();
  const [business, setBusiness] = useState<Business | null>(null),
    [entry, setEntry] = useState(""),
    [phone, setPhone] = useState("+502"),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [stage, setStage] = useState<
      "entry" | "phone" | "code" | "cards" | "no_cards"
    >("phone"),
    [mode, setMode] = useState<"login" | "join">("join"),
    [choice, setChoice] = useState<CardChoice | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cooldowns, setCooldowns] = useState<Record<string, number>>({}),
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
    setChoice(null);
    if (stage === "code") {
      setStage("phone");
    } else {
      setStage(stage === "phone" && business ? "entry" : "phone");
      setBusiness(null);
    }
  }, [stage, business, invalidateRequests]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stage === "phone" && !business && !busyRef.current) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [stage, business, back]);
  useEffect(() => {
    if (!choice) return;
    const id = setTimeout(() => {
      invalidateRequests();
      setBusy(false);
      setChoice(null);
      setError(phoneProofExpired);
    }, Math.max(0, Date.parse(choice.expiresAt) - Date.now()));
    return () => clearTimeout(id);
  }, [choice, invalidateRequests]);
  function createCard() {
    if (busyRef.current) return;
    invalidateRequests();
    setBusiness(null);
    setChoice(null);
    setCode("");
    setError("");
    setStage("entry");
  }
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
          setChoice(null);
          setCode("");
          setMode("join");
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
  const normalizedPhone = phone.replace(/[\s()-]/g, "");
  const requestPath = business
    ? `/business/${business.slug}/${mode}/request-code`
    : "/access/request-code";
  const cooldownKey = `${requestPath}:${normalizedPhone}`;
  async function requestCode() {
    if (!alive.current || busyRef.current) return;
    if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
      setError(
        "Incluye el código de país y tu número. Por ejemplo: +502 5555 5555.",
      );
      return;
    }
    if (business && mode === "join" && name.trim().length < 2) {
      setError("Escribe tu nombre para crear tu tarjeta.");
      return;
    }
    const requestedAt = Date.now();
    if ((cooldowns[cooldownKey] || 0) > requestedAt) {
      if (stage === "phone") {
        setPhone(normalizedPhone);
        setError("");
        setCode("");
        setStage("code");
      }
      return;
    }
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const pendingDeadline = requestedAt + 60000;
    // Keep each pending request's cooldown even if Back cancels its navigation.
    setCooldowns((previous) => ({
      ...previous,
      [cooldownKey]: pendingDeadline,
    }));
    try {
      await api.request(requestPath, {
        method: "POST",
        body: {
          phone: normalizedPhone,
          ...(business && mode === "join" ? { name: name.trim() } : {}),
        },
      });
      const confirmedDeadline = Date.now() + 60000;
      if (alive.current)
        setCooldowns((previous) =>
          previous[cooldownKey] === pendingDeadline
            ? { ...previous, [cooldownKey]: confirmedDeadline }
            : previous,
        );
      if (alive.current && gen === generation.current) {
        setPhone(normalizedPhone);
        setChoice(null);
        setStage("code");
        setCode("");
      }
    } catch (e) {
      if (alive.current && !(e instanceof ApiError && e.status === 429))
        setCooldowns((previous) => {
          if (previous[cooldownKey] !== pendingDeadline) return previous;
          const next = { ...previous };
          delete next[cooldownKey];
          return next;
        });
      if (alive.current && gen === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && gen === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const activate = useCallback(async (out: SignedIn, gen: number) => {
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
    if (alive.current && gen === generation.current) {
      setChoice(null);
      setCode("");
    }
    // Publishing the accepted session may already have unmounted this screen.
    if (controller.getState().session?.token === out.token)
      void controller.refresh();
  }, [controller]);
  const verify = useCallback(async () => {
    if (!alive.current || busyRef.current) return;
    const requestedAt = Date.now();
    if (!/^\d{6}$/.test(code)) {
      setError("Escribe los 6 dígitos del código.");
      return;
    }
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (business) {
        const out = await api.request<SignedIn>(
          `/business/${business.slug}/${mode}/verify`,
          {
            method: "POST",
            body: {
              phone,
              code,
              ...(mode === "join" ? { name: name.trim() } : {}),
            },
          },
        );
        await activate(out, gen);
      } else {
        const out = await api.request<AccessResult>("/access/verify", {
          method: "POST",
          body: { phone, code },
        });
        if (!alive.current || gen !== generation.current) return;
        if (out.status === "signed_in") {
          await activate(out, gen);
        } else if (out.status === "choose_card") {
          const expiresAt = Math.min(
            Date.parse(out.expiresAt),
            requestedAt + 5 * 60 * 1000,
          );
          setCode("");
          setStage("cards");
          if (!Number.isFinite(expiresAt) || expiresAt <= requestedAt) {
            setChoice(null);
            setError(phoneProofExpired);
          } else {
            // The phone proof stays in component memory and is never a session.
            setChoice({ ...out, expiresAt: new Date(expiresAt).toISOString() });
          }
        } else {
          setChoice(null);
          setCode("");
          setStage("no_cards");
        }
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
  }, [api, activate, business, code, mode, name, phone]);
  async function selectCard(businessId: string, requestedAt: number) {
    if (!alive.current || busyRef.current) return;
    if (!choice || Date.parse(choice.expiresAt) <= requestedAt) {
      setChoice(null);
      setError(phoneProofExpired);
      return;
    }
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const out = await api.request<SignedIn>("/access/select", {
        method: "POST",
        body: { accessToken: choice.accessToken, businessId },
      });
      await activate(out, gen);
    } catch (e) {
      if (alive.current && gen === generation.current) {
        if (e instanceof ApiError && e.status === 401) setChoice(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current && gen === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function preview() {
    if (!alive.current || busyRef.current) return;
    const gen = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await controller.preview(demo, {
        isCurrent: () => alive.current && gen === generation.current,
      });
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
  const remaining = Math.max(
    0,
    Math.ceil(((cooldowns[cooldownKey] || 0) - now) / 1000),
  );
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
          <View style={[layout.row, { marginBottom: 32, marginTop: 10 }]}>
            <Image
              source={require("../../assets/pf-logo.png")}
              style={{ width: 36, height: 36 }}
            />
            <Copy style={{ fontFamily: fonts.brand, fontSize: 22 }}>
              PuntosFieles.
            </Copy>
          </View>
          {(stage !== "phone" || business) && (
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
              <Heading>Crea tu tarjeta</Heading>
              <Copy
                style={{ color: colors.muted, marginTop: 8, marginBottom: 36 }}
              >
                Encuentra tu negocio para empezar a acumular puntos.
              </Copy>
              <Copy style={{ fontFamily: fonts.medium, marginBottom: 10 }}>
                Enlace o código del negocio
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
            </>
          ) : stage === "phone" ? (
            <>
              <Heading>
                {business && mode === "join" ? "Crea tu tarjeta" : "Iniciar sesión"}
              </Heading>
              <Copy style={{ color: colors.muted, marginBottom: 28 }}>
                {business
                  ? `${business.name} · ${mode === "join" ? "Crea tu tarjeta con tu teléfono." : "Ingresa con el teléfono de tu tarjeta."}`
                  : "Usa el teléfono de tu cuenta para recuperar tus tarjetas y puntos."}
              </Copy>
              {business && mode === "join" && (
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
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
                maxLength={25}
                onSubmitEditing={() => void requestCode()}
              />
              <Notice>
                Te enviaremos un código para confirmar que eres tú.
              </Notice>
              <Button
                label={remaining ? "Continuar con mi código" : "Enviarme un código"}
                loading={busy}
                onPress={() => void requestCode()}
              />
              <View style={{ marginTop: 16 }}>
                <Button
                  label={
                    !business
                      ? "Crear una tarjeta"
                      : mode === "login"
                        ? "Soy nuevo, crear mi tarjeta"
                        : "Ya tengo una tarjeta"
                  }
                  secondary
                  disabled={busy}
                  onPress={() => {
                    if (!business) createCard();
                    else if (!busyRef.current) {
                      setMode(mode === "login" ? "join" : "login");
                      setError("");
                      setCode("");
                    }
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
          ) : stage === "code" ? (
            <>
              <Heading>Confirma tu teléfono</Heading>
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
          ) : stage === "cards" ? (
            <>
              <Heading>Tus tarjetas</Heading>
              <Copy style={{ color: colors.muted, marginBottom: 28 }}>
                {choice
                  ? "Elige la tarjeta que quieres abrir."
                  : "Confirma tu teléfono de nuevo para ver tus tarjetas."}
              </Copy>
              {choice ? (
                <>
                  <View style={layout.stack}>
                    {choice.cards.map((card) => (
                      <Button
                        key={card.id}
                        label={card.name}
                        secondary
                        icon="card-outline"
                        disabled={busy}
                        onPress={() => void selectCard(card.id, Date.now())}
                      />
                    ))}
                  </View>
                  {busy && <Notice>Abriendo tu tarjeta…</Notice>}
                  <View style={{ marginTop: 24 }}>
                    <Button
                      label="Usar otro teléfono"
                      secondary
                      onPress={back}
                    />
                  </View>
                </>
              ) : (
                <Button label="Volver a verificar mi teléfono" onPress={back} />
              )}
            </>
          ) : (
            <>
              <Heading>Aún no tienes tarjetas</Heading>
              <Copy style={{ color: colors.muted, marginBottom: 28 }}>
                No encontramos tarjetas con el teléfono {phone}. Crea una en tu
                negocio favorito o ingresa con otro número.
              </Copy>
              <Button label="Crear una tarjeta" onPress={createCard} />
              <View style={{ marginTop: 16 }}>
                <Button label="Usar otro teléfono" secondary onPress={back} />
              </View>
            </>
          )}
          {(error || state.error) && (
            <Notice error>{error || state.error}</Notice>
          )}
          {(stage === "entry" || (stage === "phone" && !business)) && (
            <View style={{ marginTop: 28 }}>
              <Button
                label="Explorar una tarjeta de ejemplo"
                secondary
                icon="eye-outline"
                disabled={busy}
                onPress={() => void preview()}
              />
              <Notice>
                Recorre la app con datos de muestra, sin crear una cuenta.
              </Notice>
            </View>
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
