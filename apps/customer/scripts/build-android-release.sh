#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
export LC_ALL=C

: "${ANDROID_SDK_ROOT:?Codemagic must provide ANDROID_SDK_ROOT}"
PF_ANDROID_SIGNING_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/pf-android-signing.XXXXXXXX")
trap 'rm -rf "$PF_ANDROID_SIGNING_DIRECTORY"' EXIT
export PF_ANDROID_KEYSTORE_PATH="$PF_ANDROID_SIGNING_DIRECTORY/upload.keystore"
export PF_ANDROID_STORE_TYPE="${PF_ANDROID_STORE_TYPE:-PKCS12}"
PF_ANDROID_VERSION_CODE=$(node scripts/android-release.cjs)
export PF_ANDROID_VERSION_CODE
unset PF_ANDROID_KEYSTORE_BASE64

# Passwords stay in the environment, never command arguments or Gradle properties.
keytool -list -keystore "$PF_ANDROID_KEYSTORE_PATH" \
  -storetype "$PF_ANDROID_STORE_TYPE" -storepass:env PF_ANDROID_STORE_PASSWORD \
  -alias "$PF_ANDROID_KEY_ALIAS" >/dev/null
keytool -exportcert -rfc -keystore "$PF_ANDROID_KEYSTORE_PATH" \
  -storetype "$PF_ANDROID_STORE_TYPE" -storepass:env PF_ANDROID_STORE_PASSWORD \
  -alias "$PF_ANDROID_KEY_ALIAS" > "$PF_ANDROID_SIGNING_DIRECTORY/upload.pem"
if openssl x509 -in "$PF_ANDROID_SIGNING_DIRECTORY/upload.pem" -noout -subject | grep -Eqi 'CN[[:space:]]*=[[:space:]]*Android Debug'; then
  echo 'Android debug certificates are forbidden for release.' >&2
  exit 1
fi
PF_EXPECTED_CERTIFICATE=$(openssl x509 -in "$PF_ANDROID_SIGNING_DIRECTORY/upload.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')

# Official bundletool release, pinned to the SHA-256 published by Google's
# GitHub release API. Do not execute a downloaded jar before this check passes.
PF_BUNDLETOOL_JAR="$PF_ANDROID_SIGNING_DIRECTORY/bundletool-all-1.18.3.jar"
curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
  'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar' \
  --output "$PF_BUNDLETOOL_JAR"
printf '%s  %s\n' 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29' "$PF_BUNDLETOOL_JAR" | shasum -a 256 --check --status

sdkmanager 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
npx --no-install expo prebuild --platform android --no-install --clean
node scripts/check-android-project.mjs
(
  cd android
  # Avoid persisting a Gradle daemon that inherited the signing environment.
  ./gradlew --no-daemon :app:bundleRelease :app:assembleRelease
)

PF_APK=android/app/build/outputs/apk/release/app-release.apk
PF_AAB=android/app/build/outputs/bundle/release/app-release.aab
PF_REPORTS=build/android-release
mkdir -p "$PF_REPORTS"
test -s "$PF_APK"
test -s "$PF_AAB"
"$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$PF_APK" > "$PF_REPORTS/apk-signature-report.txt"
PF_APK_CERTIFICATE=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$PF_REPORTS/apk-signature-report.txt" | tr '[:upper:]' '[:lower:]')
test "$PF_APK_CERTIFICATE" = "$PF_EXPECTED_CERTIFICATE"
jarsigner -verify "$PF_AAB" > "$PF_REPORTS/aab-signature-report.txt"
grep -q '^jar verified\.' "$PF_REPORTS/aab-signature-report.txt"
keytool -printcert -rfc -jarfile "$PF_AAB" > "$PF_ANDROID_SIGNING_DIRECTORY/aab.pem"
PF_AAB_CERTIFICATE=$(openssl x509 -in "$PF_ANDROID_SIGNING_DIRECTORY/aab.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')
test "$PF_AAB_CERTIFICATE" = "$PF_EXPECTED_CERTIFICATE"
java -jar "$PF_BUNDLETOOL_JAR" dump config --bundle="$PF_AAB" > "$PF_REPORTS/bundle-config-report.json"
node scripts/check-android-artifacts.mjs "$PF_APK" "$PF_AAB" "$PF_REPORTS" "$PF_REPORTS/bundle-config-report.json"

# Copy binaries only after signing, manifest and alignment checks have passed.
cp "$PF_APK" "$PF_REPORTS/PuntosFieles-$PF_ANDROID_VERSION_CODE.apk"
cp "$PF_AAB" "$PF_REPORTS/PuntosFieles-$PF_ANDROID_VERSION_CODE.aab"
echo "Validated Android release version $PF_ANDROID_VERSION_CODE is ready for download."
