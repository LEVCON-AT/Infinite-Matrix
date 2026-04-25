#!/usr/bin/env bash
# lock-down.sh — Notbremse: UFW deny-all ausser Port 22 (SSH).
#
# Verwendung: bei Verdacht auf laufenden Angriff oder unklarer Bridge/Compose-Lage.
# Alle eingehenden Connections (HTTPS, Bridge, Postgres-Tunnel) werden gedropt.
# Nur SSH bleibt offen — Port 22 von ueberall, damit du selbst noch reinkommst.
#
# Aufruf: sudo /opt/recovery/scripts/lock-down.sh
# Rueckgaengig: sudo /opt/recovery/scripts/unlock.sh

set -euo pipefail

LOG_FILE="${LOG_FILE:-/var/log/matrix-recovery/matrix-recovery.log}"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
  logger -t matrix-recovery "$*" || true
}

mkdir -p "$(dirname "$LOG_FILE")"
log "=== LOCK-DOWN start ==="

# Pre-State sichern fuer unlock.sh
ufw status verbose > "/var/log/matrix-recovery/ufw-pre-lockdown-$(date -u +%Y%m%dT%H%M%SZ).txt"

# Defaults verschaerfen
ufw --force default deny incoming
ufw --force default allow outgoing

# Alle bestehenden Rules loeschen ausser SSH
# UFW-Numbered-Delete in Reverse-Order, sonst shiften die Indizes
mapfile -t rules < <(ufw status numbered | grep -E '^\[' | grep -v '22/tcp\|22 /tcp' | tac)
for rule in "${rules[@]}"; do
  num=$(echo "$rule" | grep -oP '^\[\s*\K[0-9]+')
  [[ -z "$num" ]] && continue
  ufw --force delete "$num" || true
done

# SSH explizit erlauben (idempotent)
ufw allow 22/tcp comment 'lockdown: ssh only'

ufw --force enable

log "lockdown active — only port 22 accepts inbound"
ufw status verbose | tee -a "$LOG_FILE"
log "=== LOCK-DOWN done. Run unlock.sh to revert. ==="
