#!/usr/bin/env bash
# backup-now.sh — lokales Snapshot von Postgres + Storage + Bridge-SQLite.
#
# Output: /opt/recovery/snapshots/<UTC-iso>.tar.zst
# Retention lokal: 7 Tage (aeltere werden automatisch geloescht).
# Einzelne Snapshots sind self-contained — Restore braucht nur das tar.
#
# Aufruf:
#   sudo /opt/recovery/scripts/backup-now.sh           # echter Lauf
#   sudo /opt/recovery/scripts/backup-now.sh --dry-run # Plan ohne Aktion
#
# Exit-Codes: 0=ok, 1=user-abort, 2=missing-deps, 3=disk-full, 4=fail.

set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"
BRIDGE_DIR="${BRIDGE_DIR:-/opt/matrix-bridge}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/opt/recovery/snapshots}"
STATE_DIR="${STATE_DIR:-/opt/recovery/state}"
LOG_FILE="${LOG_FILE:-/var/log/matrix-recovery/matrix-recovery.log}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
MIN_FREE_MB="${MIN_FREE_MB:-2048}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
  logger -t matrix-recovery "$*" || true
}

die() {
  log "FATAL: $*"
  exit "${2:-4}"
}

check_deps() {
  # pg_dump laeuft IN dem Postgres-Container via `docker compose exec`,
  # daher braucht der Host pg_isready/pg_dump NICHT.
  for bin in docker zstd tar sqlite3; do
    command -v "$bin" >/dev/null 2>&1 || die "missing dep: $bin" 2
  done
}

check_disk() {
  local free_mb
  free_mb=$(df --output=avail -BM "$SNAPSHOT_DIR" 2>/dev/null | tail -1 | tr -dc '0-9')
  [[ -z "$free_mb" ]] && die "cannot read disk usage for $SNAPSHOT_DIR" 3
  if (( free_mb < MIN_FREE_MB )); then
    die "disk too full: ${free_mb}MB free, need ${MIN_FREE_MB}MB" 3
  fi
  log "disk: ${free_mb}MB free at $SNAPSHOT_DIR"
}

dump_postgres() {
  local out="$1"
  log "postgres: pg_dump → $out"
  if (( DRY_RUN )); then
    echo "would: docker compose -f $SUPABASE_DIR/docker-compose.yml exec -T db pg_dump -U postgres -Fc postgres > $out"
    : > "$out"
    return
  fi
  if ! docker compose -f "$SUPABASE_DIR/docker-compose.yml" \
       exec -T db pg_dump -U postgres -Fc -Z 0 postgres > "$out"; then
    die "pg_dump failed"
  fi
  local size
  size=$(stat -c%s "$out")
  if (( size < 10000 )); then
    die "pg_dump output suspiciously small ($size bytes)"
  fi
  log "postgres: dumped $(numfmt --to=iec "$size")"
}

dump_storage() {
  local out="$1"
  local src="$SUPABASE_DIR/volumes/storage"
  log "storage: tar+zstd $src → $out"
  if [[ ! -d "$src" ]]; then
    log "storage: dir missing, skipping (creating empty marker)"
    echo "no-storage-volume-on-this-host" > "${out}.MISSING"
    return
  fi
  if (( DRY_RUN )); then
    echo "would: tar -C $src -cf - . | zstd -3 > $out"
    : > "$out"
    return
  fi
  tar -C "$src" -cf - . | zstd -3 -q -o "$out" -
}

dump_bridge() {
  local out="$1"
  local src="$BRIDGE_DIR/data/matrix.db"
  log "bridge: sqlite3 .backup $src → $out"
  if [[ ! -f "$src" ]]; then
    log "bridge: db missing, skipping"
    echo "no-bridge-db-on-this-host" > "${out}.MISSING"
    return
  fi
  if (( DRY_RUN )); then
    echo "would: sqlite3 $src \".backup '$out'\""
    : > "$out"
    return
  fi
  # .backup ist online-consistent. SQLite haelt internen Lock kurz, Bridge-Reads
  # blockieren nur fuer den I/O — keine Down-Sekunde.
  sqlite3 "$src" ".backup '$out'"
}

dump_config() {
  local out="$1"
  log "config: tar bridge .env + supabase .env"
  if (( DRY_RUN )); then
    echo "would: tar bundles .env files"
    : > "$out"
    return
  fi
  # Sammelt minimal: Bridge-.env + Supabase-.env. Service-Files gehoeren ins Repo,
  # nicht ins Backup. Wenn .env fehlt: leer-tar (kein Fehler).
  local files=()
  [[ -f "$BRIDGE_DIR/.env" ]] && files+=("$BRIDGE_DIR/.env")
  [[ -f "$SUPABASE_DIR/.env" ]] && files+=("$SUPABASE_DIR/.env")
  if [[ ${#files[@]} -eq 0 ]]; then
    : > "$out"
    return
  fi
  tar --absolute-names -czf "$out" "${files[@]}"
}

write_manifest() {
  local out="$1" stage="$2"
  cat > "$out" <<EOF
{
  "version": 1,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "supabase_dir": "$SUPABASE_DIR",
  "bridge_dir": "$BRIDGE_DIR",
  "files": {
    "postgres.dump": "$([[ -f $stage/postgres.dump ]] && stat -c%s "$stage/postgres.dump" || echo 0)",
    "storage.tar.zst": "$([[ -f $stage/storage.tar.zst ]] && stat -c%s "$stage/storage.tar.zst" || echo 0)",
    "bridge.db": "$([[ -f $stage/bridge.db ]] && stat -c%s "$stage/bridge.db" || echo 0)",
    "config.tar.gz": "$([[ -f $stage/config.tar.gz ]] && stat -c%s "$stage/config.tar.gz" || echo 0)"
  }
}
EOF
}

prune_old() {
  log "retention: deleting snapshots older than ${RETENTION_DAYS} days"
  if (( DRY_RUN )); then
    find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.tar.zst' -mtime +"$RETENTION_DAYS" -print
    return
  fi
  find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.tar.zst' -mtime +"$RETENTION_DAYS" -delete -print | \
    while read -r f; do log "deleted: $f"; done
}

main() {
  mkdir -p "$SNAPSHOT_DIR" "$STATE_DIR" "$(dirname "$LOG_FILE")"
  log "=== backup-now start (dry_run=$DRY_RUN) ==="
  check_deps
  check_disk

  local ts stage final
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  stage="$STATE_DIR/snapshot-$ts"
  final="$SNAPSHOT_DIR/${ts}.tar.zst"

  if (( DRY_RUN )); then
    log "dry-run: would stage at $stage and produce $final"
  fi

  mkdir -p "$stage"
  trap 'rm -rf "$stage"' EXIT

  dump_postgres "$stage/postgres.dump"
  dump_storage  "$stage/storage.tar.zst"
  dump_bridge   "$stage/bridge.db"
  dump_config   "$stage/config.tar.gz"
  write_manifest "$stage/manifest.json" "$stage"

  log "bundling → $final"
  if (( DRY_RUN )); then
    log "dry-run: would tar+zstd $stage → $final"
  else
    tar -C "$STATE_DIR" -cf - "snapshot-$ts" | zstd -3 -q -o "$final" -
    chmod 0600 "$final"
    chown root:root "$final"
    local size
    size=$(stat -c%s "$final")
    log "bundle: $(numfmt --to=iec "$size") at $final"
  fi

  prune_old
  log "=== backup-now done ==="
}

main "$@"
