#!/usr/bin/env bash
# VPS-Status-Check fuer Backend-Phase-0 (Supabase-Deploy)
# Aufruf (auf dem VPS): bash vps-check.sh
# Macht nur READS, keine Aenderungen. Kann als normaler User laufen;
# einige Checks (systemctl-status, disk-space) brauchen keinen sudo.

set -u
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}  $*"; }
warn() { echo -e "${YEL}[WARN]${RST} $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; }

echo "============================================"
echo " Matrix VPS — Pre-Phase-0 Status"
echo " $(date -Iseconds)"
echo " Host: $(hostname)"
echo "============================================"
echo ""

# ─── 1. OS + Kernel ───────────────────────────────────────
echo "--- 1. OS + Kernel ---"
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  echo "  Distro   : $PRETTY_NAME"
  echo "  ID       : $ID $VERSION_ID"
else
  warn "/etc/os-release nicht lesbar"
fi
echo "  Kernel   : $(uname -r)"
echo "  Arch     : $(uname -m)"
echo ""

# ─── 2. Ressourcen ────────────────────────────────────────
echo "--- 2. Ressourcen ---"
if command -v free >/dev/null; then
  mem_total_mb=$(free -m | awk '/^Mem:/{print $2}')
  mem_free_mb=$(free -m | awk '/^Mem:/{print $7}')
  swap_total_mb=$(free -m | awk '/^Swap:/{print $2}')
  echo "  RAM      : ${mem_total_mb} MB total, ${mem_free_mb} MB frei"
  echo "  Swap     : ${swap_total_mb} MB"
  if (( mem_total_mb < 3800 )); then
    fail "  RAM < 4 GB — Supabase-Stack wird eng. Upgrade empfohlen."
  elif (( mem_total_mb < 7800 )); then
    warn "  RAM 4-8 GB — ausreichend fuer Staging, knapp fuer Prod-Last. Swap empfohlen."
  else
    ok "  RAM >= 8 GB"
  fi
  if (( swap_total_mb < 2000 )); then
    warn "  Swap < 2 GB — empfohlen: 4 GB Swap bei 4 GB RAM"
  fi
fi

echo ""
echo "  Disk (root FS):"
df -h / | tail -1 | awk '{printf "    total=%s  used=%s  free=%s  use=%s\n", $2, $3, $4, $5}'
echo ""

# ─── 3. CPU ───────────────────────────────────────────────
echo "--- 3. CPU ---"
cpu_cores=$(nproc 2>/dev/null || echo "?")
echo "  Cores    : $cpu_cores"
if command -v lscpu >/dev/null; then
  lscpu | grep -E "^Model name|^CPU MHz|^CPU max MHz" | sed 's/^/  /'
fi
echo ""

# ─── 4. Network + Firewall ─────────────────────────────────
echo "--- 4. Network + Firewall ---"
echo "  Public IPs:"
ip -4 addr show 2>/dev/null | awk '/inet /{print "    " $2}' | head -5
echo ""
if command -v ufw >/dev/null; then
  ufw_status=$(sudo -n ufw status 2>/dev/null | head -1 || echo "ufw: kein sudo-Zugriff ohne Passwort")
  echo "  UFW      : $ufw_status"
else
  warn "  ufw nicht installiert (iptables/nftables direkt verwendet?)"
fi
if command -v ss >/dev/null; then
  echo "  Listening TCP ports (IPv4+IPv6, dedupliziert):"
  ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | sort -u | sed 's/^/    /' | head -15
fi
echo ""

# ─── 5. Laufende Services (systemd) ───────────────────────
echo "--- 5. Laufende Services (wichtig fuer Deploy-Konflikt) ---"
for svc in nginx matrix-bridge docker postgresql mysql mariadb; do
  if systemctl list-unit-files --no-legend 2>/dev/null | grep -q "^${svc}\.service"; then
    state=$(systemctl is-active "$svc" 2>/dev/null || echo unknown)
    echo "  ${svc}: ${state}"
  fi
done
echo ""

# ─── 6. Docker ────────────────────────────────────────────
echo "--- 6. Docker ---"
if command -v docker >/dev/null; then
  docker_version=$(docker --version 2>/dev/null)
  ok "  ${docker_version}"
  if docker compose version >/dev/null 2>&1; then
    compose_version=$(docker compose version 2>/dev/null)
    ok "  ${compose_version}"
  else
    warn "  docker compose plugin fehlt — install: apt install docker-compose-plugin"
  fi
  # Kann User docker ohne sudo?
  if docker ps >/dev/null 2>&1; then
    ok "  docker-Zugriff ohne sudo funktioniert"
  else
    warn "  docker braucht sudo — ggf. User zu 'docker' Group hinzufuegen: sudo usermod -aG docker \$USER"
  fi
else
  fail "  Docker ist NICHT installiert — wird fuer Supabase gebraucht."
  echo "         Install: https://docs.docker.com/engine/install/ (Distro-spezifisch)"
fi
echo ""

# ─── 7. nginx ─────────────────────────────────────────────
echo "--- 7. nginx ---"
if command -v nginx >/dev/null; then
  nginx_version=$(nginx -v 2>&1)
  ok "  ${nginx_version}"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    echo "  Sites-enabled:"
    ls /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/    /'
  elif [[ -d /etc/nginx/conf.d ]]; then
    echo "  conf.d:"
    ls /etc/nginx/conf.d 2>/dev/null | sed 's/^/    /'
  fi
else
  fail "  nginx nicht installiert"
fi
echo ""

# ─── 8. TLS / Let's Encrypt ───────────────────────────────
echo "--- 8. TLS / Let's Encrypt ---"
if [[ -d /etc/letsencrypt/live ]]; then
  for dom in /etc/letsencrypt/live/*/; do
    if [[ -d "$dom" && "$dom" != */README/ ]]; then
      domname=$(basename "$dom")
      cert_file="$dom/cert.pem"
      if [[ -r "$cert_file" ]]; then
        expiry=$(openssl x509 -in "$cert_file" -noout -enddate 2>/dev/null | cut -d= -f2)
        echo "  $domname: ablauf $expiry"
      fi
    fi
  done
else
  warn "  Kein /etc/letsencrypt/live/ — entweder keine TLS-Certs oder anderer Weg"
fi
echo ""

# ─── 9. Verzeichnisse ─────────────────────────────────────
echo "--- 9. Wichtige Verzeichnisse ---"
for dir in /opt/matrix-bridge /var/www/matrix /etc/nginx/sites-available; do
  if [[ -d "$dir" ]]; then
    size=$(du -sh "$dir" 2>/dev/null | cut -f1)
    echo "  $dir: $size"
  else
    echo "  $dir: (nicht vorhanden)"
  fi
done
echo ""

# ─── 10. Matrix-Bridge (Phase 4) ──────────────────────────
echo "--- 10. Matrix-Bridge (Phase 4) ---"
if systemctl is-active matrix-bridge >/dev/null 2>&1; then
  ok "  matrix-bridge.service: active"
  echo "  Port 3849 (gueltig lokal?):"
  (curl -fsS http://127.0.0.1:3849/healthz 2>/dev/null && echo) || warn "    Healthcheck fehlgeschlagen"
else
  warn "  matrix-bridge.service: inactive (oder nicht installiert)"
fi
echo ""

# ─── 11. Versionen (pnpm/node, falls lokal installiert) ──
echo "--- 11. Node + pnpm ---"
if command -v node >/dev/null; then
  ok "  node: $(node --version)"
else
  warn "  node nicht installiert — brauchen wir ggf. fuer Bridge-Build (oder CI uebernimmt)"
fi
if command -v pnpm >/dev/null; then
  ok "  pnpm: $(pnpm --version)"
else
  echo "  pnpm: (nicht installiert — corepack enable pnpm)"
fi
echo ""

# ─── 12. Dateisystem-Checks fuer Supabase-Install ────────
echo "--- 12. Deploy-Prep ---"
for dir in /opt /srv /var; do
  if [[ -d "$dir" && -w "$dir" ]]; then
    echo "  $dir: schreibbar"
  fi
done
echo ""

echo "============================================"
echo " Output abgeschlossen."
echo " Bitte alles ab '---' kopieren und ins Chat schicken,"
echo " damit wir gemeinsam die naechsten Schritte planen."
echo "============================================"
