#!/usr/bin/env bash
# restore-volumes.sh — restauriert Storage-Volume + Bridge-SQLite + Config aus Snapshot.
#
# Aufruf:
#   sudo /opt/recovery/scripts/restore-volumes.sh <snapshot.tar.zst> [--what=storage|bridge|config|all] --confirm=YES-RESTORE-<ts>
#
# Default --what=all: Storage + Bridge + Config zurueck. Granular fuer Teil-Restore.
# Stoppt jeweils den betroffenen Service vor Restore + startet ihn nach.
#
# Exit-Codes: 0=ok, 1=user-abort, 2=missing-deps, 4=fail.

set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"
BRIDGE_DIR="${BRIDGE_DIR:-/opt/matrix-bridge}"
STATE_DIR="${STATE_DIR:-/opt/recovery/state}"
LOG_FILE="${LOG_FILE:-/var/log/matrix-recovery/matrix-recovery.log}"

SNAPSHOT=""
WHAT="all"
CONFIRM=""

for arg in "$@"; do
  case "$arg" in
    --what=*) WHAT="${arg#*=}" ;;
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

[[ -z "$SNAPSHOT" ]] && die "missing snapshot path" 2
[[ ! -f "$SNAPSHOT" ]] && die "not found: $SNAPSHOT" 2
case "$WHAT" in storage|bridge|config|all) ;; *) die "invalid --what: $WHAT" 2 ;; esac

SNAP_TS=$(basename "$SNAPSHOT" .tar.zst)
EXPECTED_CONFIRM="YES-RESTORE-${SNAP_TS}"
if [[ "$CONFIRM" != "$EXPECTED_CONFIRM" ]]; then
  cat >&2 <<EOF

  This will REPLACE volumes from $SNAPSHOT (--what=$WHAT).

  To confirm, re-run with:
    --confirm=$EXPECTED_CONFIRM

EOF
  exit 1
fi

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
log "=== restore-volumes start: $SNAPSHOT (what=$WHAT) ==="

WORK="$STATE_DIR/restore-vol-${SNAP_TS}-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

zstd -dq -c "$SNAPSHOT" | tar -C "$WORK" -xf -
INNER=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
[[ -z "$INNER" ]] && die "snapshot has no inner dir"

restore_storage() {
  local src="$INNER/storage.tar.zst"
  local dst="$SUPABASE_DIR/volumes/storage"
  if [[ -f "$src.MISSING" ]] || [[ ! -f "$src" ]]; then
    log "storage: snapshot has no storage volume, skipping"
    return
  fi
  log "storage: restoring → $dst"
  # Volume-Service: kein eigener storage-Container im aktuellen Stack.
  # Bind-Mount-Owner: Supabase-Postgres laeuft als 999/999 (Postgres-uid),
  # Storage waere typischerweise 1000:1000 — wir bewahren tar-internal owner.
  local backup_dir="$dst.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -d "$dst" ]]; then
    log "storage: moving current → $backup_dir"
    mv "$dst" "$backup_dir"
  fi
  mkdir -p "$dst"
  zstd -dq -c "$src" | tar -C "$dst" -xpf -
  log "storage: restored. previous at $backup_dir"
}

restore_bridge() {
  local src="$INNER/bridge.db"
  local dst="$BRIDGE_DIR/data/matrix.db"
  if [[ -f "$src.MISSING" ]] || [[ ! -f "$src" ]]; then
    log "bridge: snapshot has no bridge db, skipping"
    return
  fi
  log "bridge: stopping matrix-bridge service"
  systemctl stop matrix-bridge || log "WARN: bridge stop failed"
  if [[ -f "$dst" ]]; then
    local backup="$dst.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    log "bridge: moving current → $backup"
    mv "$dst" "$backup"
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  chown matrix-bridge:matrix-bridge "$dst" 2>/dev/null || true
  chmod 0640 "$dst"
  log "bridge: starting matrix-bridge service"
  systemctl start matrix-bridge
}

restore_config() {
  local src="$INNER/config.tar.gz"
  if [[ ! -f "$src" || ! -s "$src" ]]; then
    log "config: snapshot has no config tar (or empty), skipping"
    return
  fi
  log "config: extracting (.env files only) — review before applying"
  local out="$STATE_DIR/config-${SNAP_TS}-extracted"
  mkdir -p "$out"
  tar -C "$out" --strip-components=0 -xzf "$src" || true
  log "config: extracted → $out (manual review + cp required, NOT auto-applied)"
}

[[ "$WHAT" == "all" || "$WHAT" == "storage" ]] && restore_storage
[[ "$WHAT" == "all" || "$WHAT" == "bridge"  ]] && restore_bridge
[[ "$WHAT" == "all" || "$WHAT" == "config"  ]] && restore_config

log "=== restore-volumes complete ==="
