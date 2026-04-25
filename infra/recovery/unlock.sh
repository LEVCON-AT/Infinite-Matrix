#!/usr/bin/env bash
# unlock.sh — UFW-Default zurueck (HTTPS + Bridge + SSH).
#
# Stellt das normale Production-UFW-Profil wieder her: 22/tcp + 80/tcp + 443/tcp.
# Andere Ports (Bridge intern auf 127.0.0.1:3849) bleiben durch nginx-Proxy abgedeckt
# und brauchen keine eigene UFW-Rule.
#
# Aufruf: sudo /opt/recovery/scripts/unlock.sh

set -euo pipefail

LOG_FILE="${LOG_FILE:-/var/log/matrix-recovery/matrix-recovery.log}"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
  logger -t matrix-recovery "$*" || true
}

mkdir -p "$(dirname "$LOG_FILE")"
log "=== UNLOCK start ==="

ufw --force default deny incoming
ufw --force default allow outgoing

ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http (certbot + redirect)'
ufw allow 443/tcp comment 'https'

ufw --force enable
log "production firewall profile restored"
ufw status verbose | tee -a "$LOG_FILE"
log "=== UNLOCK done ==="
