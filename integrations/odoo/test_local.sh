#!/usr/bin/env bash
# Disposable official Odoo + PostgreSQL; no exposed ports, production mounts or network egress.
set -euo pipefail
odoo_fixture_root=$(cd "$(dirname "$0")" && pwd)
odoo_fixture_id="pf-odoo18-check-$$"
odoo_fixture_image='odoo:18.0@sha256:f61d3e36eb699e63557bbcdf4d7bd659e51418c326009e6574565d87e1d9026d'
odoo_fixture_previous=''
odoo_fixture_mode='-i'
if [[ ${1:-} != '' && ${1:-} != '--upgrade' ]]; then
  echo 'Usage: test_local.sh [--upgrade]' >&2
  exit 2
fi
cleanup() {
  docker rm -fv "$odoo_fixture_id-app" "$odoo_fixture_id-old" "$odoo_fixture_id-db" >/dev/null 2>&1 || true
  docker network rm "$odoo_fixture_id-net" >/dev/null 2>&1 || true
  if [[ -n "$odoo_fixture_previous" ]]; then rm -rf -- "$odoo_fixture_previous"; fi
}
trap cleanup EXIT
docker network create --internal "$odoo_fixture_id-net" >/dev/null
docker run -d --name "$odoo_fixture_id-db" --network "$odoo_fixture_id-net" -e POSTGRES_DB=pf_connector_fixture -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=fixture-only-local postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139 >/dev/null
if [[ ${1:-} == '--upgrade' ]]; then
  odoo_fixture_previous=$(mktemp -d /tmp/pf-odoo18-previous.XXXXXX)
  chmod 755 "$odoo_fixture_previous"
  python3 -m zipfile -e "$odoo_fixture_root/dist/pf_pos_connector-18.0.2.0.0.zip" "$odoo_fixture_previous"
  docker run --name "$odoo_fixture_id-old" --network "$odoo_fixture_id-net" -e HOST="$odoo_fixture_id-db" -e USER=odoo -e PASSWORD=fixture-only-local -v "$odoo_fixture_previous:/mnt/extra-addons:ro" "$odoo_fixture_image" odoo -d pf_connector_fixture -i pf_pos_connector --without-demo=all --stop-after-init --http-interface=127.0.0.1 --max-cron-threads=0 --log-level=warn
  odoo_fixture_mode='-u'
fi
docker run --name "$odoo_fixture_id-app" --network "$odoo_fixture_id-net" -e HOST="$odoo_fixture_id-db" -e USER=odoo -e PASSWORD=fixture-only-local -v "$odoo_fixture_root:/mnt/extra-addons:ro" "$odoo_fixture_image" odoo -d pf_connector_fixture "$odoo_fixture_mode" pf_pos_connector --without-demo=all --test-enable --test-tags /pf_pos_connector --stop-after-init --http-interface=127.0.0.1 --max-cron-threads=0 --log-level=test
