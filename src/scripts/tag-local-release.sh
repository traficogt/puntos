#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-release-$(date -u +%Y%m%dT%H%M%SZ)}"
SOURCE_IMAGE="${SOURCE_IMAGE:-puntos-api:latest}"
TARGET_IMAGE="puntos-api:${TAG}"

docker image inspect "${SOURCE_IMAGE}" >/dev/null 2>&1
docker tag "${SOURCE_IMAGE}" "${TARGET_IMAGE}"

echo "Tagged ${SOURCE_IMAGE} as ${TARGET_IMAGE}"
