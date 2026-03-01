#!/usr/bin/env bash
set -euo pipefail

URL=${1:-http://localhost:3001/api/health}
TIMEOUT=${TIMEOUT:-60}
SLEEP=${SLEEP:-2}

echo "Waiting for API at $URL (timeout ${TIMEOUT}s)..."
end=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $end ]; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "API is up."
    exit 0
  fi
  sleep "$SLEEP"
done

echo "API did not become healthy within ${TIMEOUT}s"
exit 1
