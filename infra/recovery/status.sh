#!/usr/bin/env bash
# status.sh — Schnell-Diagnose: letzter Snapshot, Disk-Free, systemd-Status,
# Bridge + Postgres + nginx-Health.
#
# Aufruf: sudo /opt/recovery/scripts/status.sh
# Read-only, keine Aenderungen am System.

set -uo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/opt/recovery/snapshots}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

bold "Matrix Recovery Status — $(date -u +%Y-%m-%dT%H:%M:%SZ) — host $(hostname)"

bold "→ Disk"
df -h /opt /var/log 2>/dev/null | sed 's/^/  /'

bold "→ Snapshots ($SNAPSHOT_DIR)"
if [[ -d "$SNAPSHOT_DIR" ]]; then
  count=$(find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.tar.zst' | wc -l)
  if (( count == 0 )); then
    err "no snapshots — run backup-now.sh"
  else
    latest=$(find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.tar.zst' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
    age_sec=$(( $(date +%s) - $(stat -c%Y "$latest") ))
    age_h=$(( age_sec / 3600 ))
    size=$(stat -c%s "$latest" | numfmt --to=iec)
    if (( age_h > 26 )); then
      warn "$count snapshot(s); latest $age_h h old: $latest ($size)"
    else
      ok "$count snapshot(s); latest $age_h h old: $latest ($size)"
    fi
  fi
else
  err "$SNAPSHOT_DIR does not exist"
fi

bold "→ systemd timers"
if systemctl list-timers --all 2>/dev/null | grep -q backup-cron; then
  systemctl list-timers --all 2>/dev/null | grep -E 'NEXT|backup-cron' | sed 's/^/  /'
else
  err "backup-cron.timer not registered"
fi

bold "→ Services"
for svc in matrix-bridge sshd nginx fail2ban; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    ok "$svc active"
  elif systemctl list-unit-files 2>/dev/null | grep -q "^$svc"; then
    err "$svc inactive"
  else
    warn "$svc not installed"
  fi
done

bold "→ Docker (Supabase)"
if [[ -f "$SUPABASE_DIR/docker-compose.yml" ]]; then
  if command -v docker >/dev/null && docker compose -f "$SUPABASE_DIR/docker-compose.yml" ps 2>/dev/null | tail -n +2 > /tmp/.docker-status.$$; then
    while IFS= read -r line; do
      if echo "$line" | grep -q "Up\|running"; then
        ok "${line:0:80}"
      else
        warn "${line:0:80}"
      fi
    done < /tmp/.docker-status.$$
    rm -f /tmp/.docker-status.$$
  else
    err "docker compose ps failed (or docker not running)"
  fi
else
  warn "no $SUPABASE_DIR/docker-compose.yml — Supabase not deployed?"
fi

bold "→ Health-Endpoints"
for url in https://staging.matrix.levcon.at/app/ https://matrix.levcon.at/healthz; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "ERR")
  if [[ "$code" == "200" ]]; then
    ok "$url → 200"
  else
    err "$url → $code"
  fi
done

bold "→ Firewall (UFW)"
if command -v ufw >/dev/null; then
  ufw status 2>/dev/null | head -5 | sed 's/^/  /'
else
  warn "ufw not installed"
fi

echo
