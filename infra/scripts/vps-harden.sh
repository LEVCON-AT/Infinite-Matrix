#!/usr/bin/env bash
# VPS-Hardening fuer Backend-Phase-0
# Interaktiv. Jeder Schritt wird einzeln bestaetigt.
# Macht destruktive Aenderungen — Backup vor jedem Commit.
#
# Aufruf: sudo bash vps-harden.sh
# Zum Zurueckrollen: /var/backups/vps-harden/ enthaelt die ersetzten Files.

set -u
BACKUP_DIR="/var/backups/vps-harden/$(date +%Y%m%d-%H%M%S)"
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m'
BLUE='\033[0;34m' ; BOLD='\033[1m' ; RST='\033[0m'

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}Bitte mit sudo starten.${RST}"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo -e "${BLUE}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "  VPS Hardening fuer Supabase-Phase-0"
echo "  Backup-Dir: $BACKUP_DIR"
echo "═══════════════════════════════════════════════════════════"
echo -e "${RST}"

ask() {
  local prompt="$1"
  echo ""
  echo -e "${YEL}${BOLD}▶ $prompt${RST}"
  read -r -p "  Ausfuehren? [y/N/q=quit] " ans
  case "${ans,,}" in
    y|yes|j|ja) return 0 ;;
    q|quit) echo "Abgebrochen."; exit 0 ;;
    *) echo "  ↳ uebersprungen."; return 1 ;;
  esac
}

info()    { echo -e "  ${BLUE}→${RST} $*"; }
ok()      { echo -e "  ${GREEN}✓${RST} $*"; }
warn()    { echo -e "  ${YEL}!${RST} $*"; }
err()     { echo -e "  ${RED}✗${RST} $*"; }

# ═══════════════════════════════════════════════════════════════════
# PHASE A — Swap + Journald-Limit (sicher, keine Service-Unterbrechung)
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE A — Swap + Journald ═══${RST}"

# A1. Swap
if ask "A1) 4 GB Swap-File anlegen (/swapfile), swappiness=10"; then
  if [[ -f /swapfile ]]; then
    warn "/swapfile existiert bereits — ueberspringe Anlegen."
  else
    info "Erstelle 4 GB Swap-File (dauert ~20 s)…"
    fallocate -l 4G /swapfile && \
      chmod 600 /swapfile && \
      mkswap /swapfile && \
      swapon /swapfile && \
      ok "Swap aktiv."
    if ! grep -q "/swapfile" /etc/fstab; then
      echo "/swapfile none swap sw 0 0" >> /etc/fstab
      ok "fstab-Eintrag hinzugefuegt (persistent ueber Reboots)."
    fi
  fi
  # swappiness
  sysctl -w vm.swappiness=10 >/dev/null
  if ! grep -q "vm.swappiness" /etc/sysctl.d/99-matrix.conf 2>/dev/null; then
    echo "vm.swappiness=10" > /etc/sysctl.d/99-matrix.conf
    ok "swappiness=10 persistent gesetzt."
  fi
  free -h
fi

# A2. Journald-Limit
if ask "A2) systemd-journald auf 200 MB begrenzen (aktuell ~750 MB)"; then
  cp /etc/systemd/journald.conf "$BACKUP_DIR/journald.conf.bak"
  # sed: setzt oder fuegt SystemMaxUse=200M unter [Journal] ein
  if grep -q "^SystemMaxUse=" /etc/systemd/journald.conf; then
    sed -i 's/^SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf
  elif grep -q "^#SystemMaxUse=" /etc/systemd/journald.conf; then
    sed -i 's/^#SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf
  else
    sed -i '/\[Journal\]/a SystemMaxUse=200M' /etc/systemd/journald.conf
  fi
  systemctl restart systemd-journald
  ok "journald neu gestartet, Logs werden auf 200 MB gekuerzt."
  journalctl --disk-usage
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE B — Unnoetige Services disable
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE B — Unnoetige Services ═══${RST}"

disable_svc() {
  local svc="$1"
  local desc="$2"
  if systemctl is-active --quiet "$svc" 2>/dev/null || systemctl is-enabled --quiet "$svc" 2>/dev/null; then
    if ask "B-$svc) $desc"; then
      systemctl disable --now "$svc" 2>&1 | sed 's/^/    /'
      ok "$svc disabled."
    fi
  else
    info "$svc bereits inaktiv — skip."
  fi
}

# CUPS ueber Snap
if snap list 2>/dev/null | grep -q "^cups "; then
  if ask "B-cups) CUPS-Snap entfernen (Drucker-Dienst, Port 631 — auf Server ueberfluessig)"; then
    snap disable cups 2>&1 | sed 's/^/    /'
    ok "CUPS disabled. (Fuer komplettes Entfernen: snap remove cups)"
  fi
fi

disable_svc fwupd.service "fwupd disable (Firmware-Updates — auf Cloud-VPS nicht sinnvoll)"
disable_svc multipathd.service "multipathd disable (nur fuer Multipath-Storage noetig)"
disable_svc ModemManager.service "ModemManager disable (fuer Mobilfunk-Modems, irrelevant auf VPS)"
disable_svc udisks2.service "udisks2 disable (Disk-Management fuer Desktop)"

# ═══════════════════════════════════════════════════════════════════
# PHASE C — Cleanup (nginx + docker)
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE C — Cleanup ═══${RST}"

if [[ -L /etc/nginx/sites-enabled/bot ]] || [[ -f /etc/nginx/sites-enabled/bot ]]; then
  if ask "C1) nginx-Site 'bot' (agent.levcon.at) entfernen — Backend auf :18789 ist tot"; then
    cp /etc/nginx/sites-enabled/bot "$BACKUP_DIR/nginx-bot.bak" 2>/dev/null || true
    # Falls es in sites-available ein Original gibt, auch kopieren
    [[ -f /etc/nginx/sites-available/bot ]] && cp /etc/nginx/sites-available/bot "$BACKUP_DIR/nginx-bot.available.bak"
    rm /etc/nginx/sites-enabled/bot
    # sites-available laesst du bestehen — nur Enabled-Symlink entfernt
    info "Backup: $BACKUP_DIR/nginx-bot*.bak"
    if nginx -t 2>&1 | grep -q "syntax is ok"; then
      systemctl reload nginx
      ok "nginx reloaded."
    else
      err "nginx-test gescheitert — site wiederherstellen!"
      cp "$BACKUP_DIR/nginx-bot.bak" /etc/nginx/sites-enabled/bot
      systemctl reload nginx
    fi
  fi
fi

if docker ps -a --format "{{.Names}}" | grep -q "^root-n8n-1$"; then
  if ask "C2) Gestoppten Container 'root-n8n-1' entfernen (2 Wochen exited)"; then
    docker rm root-n8n-1 && ok "Container entfernt."
  fi
fi

if ask "C3) Docker Image/Volume-Prune (entfernt alle ungenutzten — Speicherplatz-Gewinn)"; then
  docker image prune -af 2>&1 | tail -5 | sed 's/^/    /'
  docker volume prune -f 2>&1 | tail -5 | sed 's/^/    /'
  ok "Prune fertig."
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE D — Port-Binding-Haertung (n8n)
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE D — Port-Binding ═══${RST}"

if [[ -f /root/docker-compose.yaml ]]; then
  if ask "D1) n8n-Port 5678 nur noch lokal (127.0.0.1:5678) — nginx proxied weiter via engine.levcon.at"; then
    cp /root/docker-compose.yaml "$BACKUP_DIR/n8n-docker-compose.yaml.bak"
    # Ersetze '5678:5678' durch '127.0.0.1:5678:5678' — nur wenn noch nicht so
    if grep -q '"127\.0\.0\.1:5678:5678"\|'"'"'127\.0\.0\.1:5678:5678'"'" /root/docker-compose.yaml; then
      info "n8n bereits an 127.0.0.1 gebunden — skip."
    else
      sed -i 's|"5678:5678"|"127.0.0.1:5678:5678"|g; s|'"'"'5678:5678'"'"'|'"'"'127.0.0.1:5678:5678'"'"'|g' /root/docker-compose.yaml
      info "Wenn kein Match gab es evtl. ein anderes Format. Bitte pruefen:"
      grep -n "5678" /root/docker-compose.yaml || true
      info "Container neu starten:"
      cd /root && docker compose up -d
      ok "n8n neu gestartet. Port-Status:"
      ss -tlnp | grep 5678 | sed 's/^/    /'
    fi
  fi
fi

echo ""
info "PM2-Services (pdf-generator :3000, next-server :3001) sind NICHT in diesem Script."
info "Manuelle Schritte, falls gewuenscht (empfohlen, nicht erzwungen):"
echo "    pm2 ls                                          # welche Apps"
echo "    pm2 show <name>                                 # config anschauen"
echo "    # Falls Apps direkt auf 0.0.0.0 binden (z.B. via HOST-env):"
echo "    # Ecosystem-File anpassen → HOST=127.0.0.1"
echo "    pm2 restart <name> --update-env"

# ═══════════════════════════════════════════════════════════════════
# PHASE E — UFW Firewall
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE E — Firewall (ufw) ═══${RST}"
echo -e "${YEL}${BOLD}"
echo "  ⚠  WICHTIG: UFW aktivieren kann SSH abbrechen, wenn Regeln falsch."
echo "  ⚠  Ich lege die Regeln erst ALLE an, aktiviere UFW erst zuletzt."
echo "  ⚠  Deine SSH-Session sollte NICHT abbrechen — aber: zweites Terminal"
echo "  ⚠  bereithalten, fuer den Fall, dass sie doch abbricht."
echo -e "${RST}"

if ask "E1) UFW-Regeln vorbereiten (SSH+HTTP+HTTPS whitelisten, noch NICHT aktivieren)"; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp    comment 'SSH'
  ufw allow 80/tcp    comment 'HTTP'
  ufw allow 443/tcp   comment 'HTTPS'
  ok "Regeln gesetzt. Status-Preview (noch inactive):"
  ufw status numbered | sed 's/^/    /'
fi

if ask "E2) UFW JETZT aktivieren (letzte Chance zum Abbrechen!)"; then
  echo -e "${YEL}  ! Stelle sicher, dass du ein zweites SSH-Fenster offen hast.${RST}"
  read -r -p "  Wirklich aktivieren? Schreibe 'ACTIVATE' zum Bestaetigen: " confirm
  if [[ "$confirm" == "ACTIVATE" ]]; then
    ufw --force enable
    ok "UFW aktiv. Status:"
    ufw status verbose | sed 's/^/    /'
    info "Test aus zweiter Session: ssh sollte noch funktionieren, HTTPS erreichbar, andere Ports geblockt."
  else
    info "Nicht aktiviert. Regeln bleiben vorbereitet; aktivieren spaeter: sudo ufw enable"
  fi
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE F — Final-Check
# ═══════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ PHASE F — Final-Status ═══${RST}"
echo ""
echo "RAM + Swap:"
free -h
echo ""
echo "Journald-Groesse:"
journalctl --disk-usage
echo ""
echo "UFW-Status:"
ufw status 2>/dev/null || true
echo ""
echo "Ports die weiterhin horchen (sollte nur Erwartetes sein):"
ss -tlnp 2>/dev/null | head -20
echo ""
echo -e "${GREEN}${BOLD}═══ Hardening abgeschlossen ═══${RST}"
echo "Backup-Dir: $BACKUP_DIR"
echo "Vergleich nach paar Stunden: free -h + ss -tlnp"
