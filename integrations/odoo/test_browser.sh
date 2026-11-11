#!/usr/bin/env bash
# Disposable Odoo HTTP test + host Playwright, internal Docker network only.
set -euo pipefail
pf_browser_root=$(cd "$(dirname "$0")" && pwd)
pf_browser_id="pf-odoo18-browser-$$"
pf_browser_artifacts=$(mktemp -d /tmp/pf-odoo18-browser.XXXXXX)
chmod 777 "$pf_browser_artifacts"
cleanup() {
  docker logs "$pf_browser_id-app" > "$pf_browser_artifacts/odoo.log" 2>&1 || true
  docker rm -fv "$pf_browser_id-app" "$pf_browser_id-db" >/dev/null 2>&1 || true
  docker network rm "$pf_browser_id-net" >/dev/null 2>&1 || true
  echo "Browser evidence: $pf_browser_artifacts"
}
trap cleanup EXIT
docker network create --internal "$pf_browser_id-net" >/dev/null
docker run -d --name "$pf_browser_id-db" --network "$pf_browser_id-net" -e POSTGRES_DB=pf_browser_fixture -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=fixture-only-local postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139 >/dev/null
docker run -d --name "$pf_browser_id-app" --network "$pf_browser_id-net" -e HOST="$pf_browser_id-db" -e USER=odoo -e PASSWORD=fixture-only-local -e PF_BROWSER_FIXTURE_DIR=/tmp/pf-browser-evidence -v "$pf_browser_artifacts:/tmp/pf-browser-evidence" -v "$pf_browser_root:/mnt/extra-addons:ro" -v "$pf_browser_root/fixtures:/mnt/browser-addons:ro" odoo:18.0@sha256:f61d3e36eb699e63557bbcdf4d7bd659e51418c326009e6574565d87e1d9026d odoo -d pf_browser_fixture -i pf_checkout_browser_fixture --addons-path=/mnt/extra-addons,/mnt/browser-addons,/usr/lib/python3/dist-packages/odoo/addons --without-demo=all --test-enable --test-tags /pf_checkout_browser_fixture --stop-after-init --http-interface=0.0.0.0 --max-cron-threads=0 --log-level=test >/dev/null
pf_browser_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$pf_browser_id-app")
PF_BROWSER_FIXTURE_DIR="$pf_browser_artifacts" PF_BROWSER_ORIGIN="http://$pf_browser_ip:8069" node "$pf_browser_root/tests/browser_checkout.mjs"
pf_browser_exit=$(docker wait "$pf_browser_id-app")
test "$pf_browser_exit" = 0
