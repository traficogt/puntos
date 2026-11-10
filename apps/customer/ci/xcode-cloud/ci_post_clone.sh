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
[[ "$PF_NODE_VERSION" == 22.22.2 ]] || { echo 'Update the pinned Node checksums when changing .nvmrc.' >&2; exit 1; }
case "$(uname -m)" in
  arm64) PF_NODE_ARCH=arm64; PF_NODE_SHA=db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000 ;;
  x86_64) PF_NODE_ARCH=x64; PF_NODE_SHA=12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba ;;
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
