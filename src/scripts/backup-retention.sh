#!/usr/bin/env bash
set -euo pipefail

DIR="backups"
KEEP_DAILY=14
KEEP_WEEKLY=8
APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      DIR="${2:-}"
      shift 2
      ;;
    --keep-daily)
      KEEP_DAILY="${2:-14}"
      shift 2
      ;;
    --keep-weekly)
      KEEP_WEEKLY="${2:-8}"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    *)
      echo "Unknown arg: $1"
      echo "Usage: bash src/scripts/backup-retention.sh [--dir backups] [--keep-daily 14] [--keep-weekly 8] [--apply]"
      exit 1
      ;;
  esac
done

mkdir -p "$DIR"

python3 - "$DIR" "$KEEP_DAILY" "$KEEP_WEEKLY" "$APPLY" <<'PY'
import os
import re
import sys
from datetime import datetime, timedelta, timezone

dir_path = sys.argv[1]
keep_daily = int(sys.argv[2])
keep_weekly = int(sys.argv[3])
apply = int(sys.argv[4]) == 1

rx = re.compile(r"^puntos_(\d{8})_(\d{6})\.sql\.gz$")
items = []
for name in os.listdir(dir_path):
    m = rx.match(name)
    if not m:
        continue
    dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    items.append((dt, name))

items.sort(reverse=True)
if not items:
    print("No backups found for retention.")
    sys.exit(0)

cutoff = datetime.now(timezone.utc) - timedelta(days=keep_daily)
keep = set()

# Keep all backups newer than cutoff.
for dt, name in items:
    if dt >= cutoff:
        keep.add(name)

# For older backups, keep only the newest backup per ISO week, up to keep_weekly weeks.
weekly_kept = 0
seen_weeks = set()
for dt, name in items:
    if dt >= cutoff:
        continue
    year, week, _ = dt.isocalendar()
    wk = (year, week)
    if wk in seen_weeks:
        continue
    if weekly_kept >= keep_weekly:
        continue
    seen_weeks.add(wk)
    keep.add(name)
    weekly_kept += 1

delete = [name for _, name in items if name not in keep]

print(f"Backups total: {len(items)}")
print(f"Keep daily window: {keep_daily} days")
print(f"Keep weekly snapshots: {keep_weekly}")
print(f"Will keep: {len(keep)}")
print(f"Will delete: {len(delete)}")

for name in delete:
    print(f"DELETE {name}")
    if apply:
        os.remove(os.path.join(dir_path, name))

if apply:
    print("Retention applied.")
else:
    print("Dry run only. Re-run with --apply to delete old backups.")
PY
