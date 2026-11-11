#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

PF_ANDROID_PHASE="${1:-}"
case "$PF_ANDROID_PHASE" in
  setup|build) ;;
  *) echo 'Expected setup or build; this tool never publishes an app.' >&2; exit 2 ;;
esac
test "$(node --version)" = v22.23.5 || { echo 'Node 22.23.5 is required.' >&2; exit 1; }
java -version 2>&1 | grep -q 'version "17\.' || { echo 'Java 17 is required.' >&2; exit 1; }
: "${ANDROID_SDK_ROOT:?Android SDK cache is required}"
: "${GRADLE_USER_HOME:?Gradle cache is required}"
: "${npm_config_cache:?npm cache is required}"
PF_ANDROID_TOOLS_HOME="${PF_ANDROID_TOOLS_HOME:-/opt/android-tools/latest}"
test -x "$PF_ANDROID_TOOLS_HOME/bin/sdkmanager"
mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools" "$GRADLE_USER_HOME" "$npm_config_cache"
if [[ ! -e "$ANDROID_SDK_ROOT/cmdline-tools/latest" ]]; then
  ln -s "$PF_ANDROID_TOOLS_HOME" "$ANDROID_SDK_ROOT/cmdline-tools/latest"
fi
test "$(readlink "$ANDROID_SDK_ROOT/cmdline-tools/latest")" = "$PF_ANDROID_TOOLS_HOME" || {
  echo 'Android SDK cache belongs to a different toolchain; use a dedicated cache.' >&2; exit 1;
}
PF_SDK_MANAGER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

if [[ "$PF_ANDROID_PHASE" == setup ]]; then
  # sdkmanager may close stdin once all licenses are accepted; yes's SIGPIPE
  # must not hide a successful sdkmanager status, or ignore a real SDK failure.
  set +o pipefail
  yes | "$PF_SDK_MANAGER" --sdk_root="$ANDROID_SDK_ROOT" --licenses
  PF_LICENSE_STATUS="${PIPESTATUS[1]}"
  set -o pipefail
  test "$PF_LICENSE_STATUS" -eq 0
  "$PF_SDK_MANAGER" --sdk_root="$ANDROID_SDK_ROOT" --channel=0 \
    'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
  echo 'Android SDK 36, build tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1 are installed.'
  exit 0
fi

: "${PF_ANDROID_VERSION_CODE:?Choose an explicit Android version code}"
: "${PF_ANDROID_KEY_ALIAS:?Existing Android upload key alias is required}"
PF_ANDROID_SIGNING_KEY_FILE="${PF_ANDROID_SIGNING_KEY_FILE:-/run/secrets/android-upload.p12}"
PF_ANDROID_PASSWORD_FILE="${PF_ANDROID_PASSWORD_FILE:-/run/secrets/android-password}"
test -r "$PF_ANDROID_SIGNING_KEY_FILE" && test -s "$PF_ANDROID_SIGNING_KEY_FILE" || { echo 'Android upload key is missing.' >&2; exit 1; }
test -r "$PF_ANDROID_PASSWORD_FILE" && test -s "$PF_ANDROID_PASSWORD_FILE" || { echo 'Android upload password is missing.' >&2; exit 1; }
cd "${PF_ANDROID_WORK_DIR:-/work}"
test "$(node --version)" = "v$(tr -d '[:space:]' < .nvmrc)"
cat > "$GRADLE_USER_HOME/gradle.properties" <<'PROPERTIES'
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
org.gradle.workers.max=1
org.gradle.parallel=false
org.gradle.daemon=false
org.gradle.vfs.watch=false
kotlin.compiler.execution.strategy=in-process
PROPERTIES
# Gradle's worker limit does not constrain Ninja. Keep one native compiler/linker
# active per module and share the Gradle JVM with Kotlin within the 4 GiB cap.
mkdir -p "$GRADLE_USER_HOME/init.d"
cat > "$GRADLE_USER_HOME/init.d/pf-native-memory.gradle" <<'INIT'
gradle.beforeProject { project ->
    ['com.android.application', 'com.android.library'].each { pluginId ->
        project.pluginManager.withPlugin(pluginId) {
            project.extensions.getByName('android').defaultConfig.externalNativeBuild.cmake.arguments.addAll([
                '-DCMAKE_JOB_POOLS=pf_native=1',
                '-DCMAKE_JOB_POOL_COMPILE=pf_native',
                '-DCMAKE_JOB_POOL_LINK=pf_native'
            ])
        }
    }
}
INIT
export NODE_OPTIONS=--max-old-space-size=1536
export EXPO_NO_TELEMETRY=1
export CI=true
npm ci --include=dev --no-audit --no-fund
npm run lint
npm run typecheck
npm test

# Load credentials only after dependency installation and source checks. They
# never enter Docker image layers, Docker configuration or process arguments.
PF_ANDROID_KEYSTORE_BASE64=$(base64 < "$PF_ANDROID_SIGNING_KEY_FILE" | tr -d '\n')
PF_ANDROID_STORE_PASSWORD=$(cat "$PF_ANDROID_PASSWORD_FILE")
PF_ANDROID_KEY_PASSWORD="$PF_ANDROID_STORE_PASSWORD"
export PF_ANDROID_KEYSTORE_BASE64 PF_ANDROID_STORE_PASSWORD PF_ANDROID_KEY_PASSWORD
export PF_ANDROID_STORE_TYPE=PKCS12
trap 'unset PF_ANDROID_KEYSTORE_BASE64 PF_ANDROID_STORE_PASSWORD PF_ANDROID_KEY_PASSWORD' EXIT
bash scripts/build-android-release.sh all
