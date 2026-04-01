#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash src/scripts/rollback-local-image.sh <release-tag>"
  exit 1
fi

TAG="$1"
SOURCE_IMAGE="puntos-api:${TAG}"
TARGET_IMAGE="${TARGET_IMAGE:-puntos-api:latest}"

docker image inspect "${SOURCE_IMAGE}" >/dev/null 2>&1
docker tag "${SOURCE_IMAGE}" "${TARGET_IMAGE}"
docker compose up -d --force-recreate api

echo "Rolled back api to ${SOURCE_IMAGE}"
