#!/bin/bash
set -euo pipefail

# This source is copied into ios/ci_scripts by the Expo config plugin.
# Apple invokes that copy after checkout. All paths are scoped to this app.
PF_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PF_APP_DIR="$(cd "$PF_SCRIPT_DIR/../.." && pwd)"
if [[ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]]; then
  PF_APP_DIR="$CI_PRIMARY_REPOSITORY_PATH/apps/customer"
fi
cd "$PF_APP_DIR"
[[ "$(uname -s)" == Darwin ]] || { echo 'Xcode Cloud bootstrap requires macOS.' >&2; exit 1; }
PF_NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
[[ "$PF_NODE_VERSION" == 22.23.5 ]] || { echo 'Update the pinned Node checksums when changing .nvmrc.' >&2; exit 1; }
case "$(uname -m)" in
  arm64) PF_NODE_ARCH=arm64; PF_NODE_SHA=e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d ;;
  x86_64) PF_NODE_ARCH=x64; PF_NODE_SHA=c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422 ;;
  *) echo 'Unsupported macOS architecture.' >&2; exit 1 ;;
esac
PF_TOOLS_DIR="$PF_APP_DIR/.ci-tools"
PF_NODE_DIR="$PF_TOOLS_DIR/node"
mkdir -p "$PF_NODE_DIR"
PF_NODE_ARCHIVE="node-v$PF_NODE_VERSION-darwin-$PF_NODE_ARCH.tar.gz"
curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 --max-time 180 \
  "https://nodejs.org/dist/v$PF_NODE_VERSION/$PF_NODE_ARCHIVE" -o "$PF_TOOLS_DIR/$PF_NODE_ARCHIVE"
printf '%s  %s\n' "$PF_NODE_SHA" "$PF_TOOLS_DIR/$PF_NODE_ARCHIVE" | shasum -a 256 --check
tar -xzf "$PF_TOOLS_DIR/$PF_NODE_ARCHIVE" -C "$PF_NODE_DIR" --strip-components=1
rm "$PF_TOOLS_DIR/$PF_NODE_ARCHIVE"
export PATH="$PF_NODE_DIR/bin:$PATH"
export NODE_BINARY="$PF_NODE_DIR/bin/node"
export CI=1 EXPO_NO_TELEMETRY=1 COCOAPODS_DISABLE_STATS=true
node --version
npm --version
npm ci --include=dev --no-audit --no-fund
npm run check:xcode-cloud
npm run typecheck
npm run lint
npm test

# Xcode invokes bundle phases in a new shell. Keep the verified Node path available.
printf 'export NODE_BINARY=%q\nexport PATH=%q:"$PATH"\n' "$NODE_BINARY" "$PF_NODE_DIR/bin" > ios/.xcode.env.local
if ! command -v pod >/dev/null 2>&1; then
  HOMEBREW_NO_AUTO_UPDATE=1 brew install cocoapods
fi
pod --version
cd ios
if [[ -f Podfile.lock ]]; then
  pod install --deployment
else
  echo 'Bootstrap: resolving the first Podfile.lock. Commit it after the first successful macOS installation.'
  pod install
fi
test -d PuntosFieles.xcworkspace
echo 'Dependencies and configuration checks complete; Xcode Cloud can now compile the app.'
