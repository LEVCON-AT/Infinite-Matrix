#!/usr/bin/env bash
# restore-postgres.sh — restauriert Postgres aus einem Snapshot.
#
# Aufruf:
#   sudo /opt/recovery/scripts/restore-postgres.sh <snapshot.tar.zst> --confirm=YES-RESTORE-<ts>
#   sudo /opt/recovery/scripts/restore-postgres.sh <snapshot.tar.zst> --target=/tmp/test --confirm=YES-RESTORE-<ts>
#
# Default-Target: live Postgres-Container (matrix-supabase-db).
# --target=<dir>: extrahiert nur in den Test-Pfad, kein DB-Restore. Fuer Drills.
#
# Exit-Codes: 0=ok, 1=user-abort, 2=missing-deps, 4=fail.

set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"
STATE_DIR="${STATE_DIR:-/opt/recovery/state}"
LOG_FILE="${LOG_FILE:-/var/log/matrix-recovery/matrix-recovery.log}"

SNAPSHOT=""
TARGET=""
CONFIRM=""

for arg in "$@"; do
  case "$arg" in
    --target=*) TARGET="${arg#*=}" ;;
    --confirm=*) CONFIRM="${arg#*=}" ;;
    *.tar.zst) SNAPSHOT="$arg" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
  logger -t matrix-recovery "$*" || true
}

die() {
  log "FATAL: $*"
  exit "${2:-4}"
}

[[ -z "$SNAPSHOT" ]] && die "missing snapshot path (positional .tar.zst)" 2
[[ ! -f "$SNAPSHOT" ]] && die "snapshot not found: $SNAPSHOT" 2

# Confirm-Format: YES-RESTORE-<snapshot-ts>
SNAP_TS=$(basename "$SNAPSHOT" .tar.zst)
EXPECTED_CONFIRM="YES-RESTORE-${SNAP_TS}"
if [[ "$CONFIRM" != "$EXPECTED_CONFIRM" ]]; then
  cat >&2 <<EOF

  This will REPLACE the Postgres database from $SNAPSHOT.
  All data committed since that snapshot will be LOST.

  To confirm, re-run with:
    --confirm=$EXPECTED_CONFIRM

EOF
  exit 1
fi

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
log "=== restore-postgres start: $SNAPSHOT ==="

WORK="$STATE_DIR/restore-${SNAP_TS}-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

log "extracting → $WORK"
zstd -dq -c "$SNAPSHOT" | tar -C "$WORK" -xf -

INNER=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
[[ -z "$INNER" ]] && die "snapshot has no inner snapshot-* dir"

DUMP="$INNER/postgres.dump"
[[ ! -f "$DUMP" ]] && die "no postgres.dump in snapshot"

# Drill-Mode: nur extrahieren, kein DB-Restore
if [[ -n "$TARGET" ]]; then
  mkdir -p "$TARGET"
  cp -a "$INNER"/* "$TARGET/"
  log "DRILL-MODE: extracted to $TARGET, no live restore performed"
  log "verify: pg_restore -l $TARGET/postgres.dump | head"
  exit 0
fi

# Live-Restore: in matrix-supabase-db
log "live restore against matrix-supabase-db (postgres user)"
log "this drops + recreates the postgres database"

# Sicherheits-Snapshot vor dem Drop
PRE_RESTORE="$STATE_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
log "pre-restore safety dump → $PRE_RESTORE"
docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T db \
  pg_dump -U postgres -Fc -Z 0 postgres > "$PRE_RESTORE" || \
  log "WARN: pre-restore dump failed (DB may be down) — proceeding"

# Restore
docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T db \
  pg_restore -U postgres -d postgres --clean --if-exists --no-owner < "$DUMP"

log "restore done. pre-restore dump kept at $PRE_RESTORE"
log "=== restore-postgres complete ==="
