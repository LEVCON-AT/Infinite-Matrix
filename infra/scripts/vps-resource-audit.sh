#!/usr/bin/env bash
# VPS-Resource-Audit: welche Dienste fressen RAM?
# Welche Sites werden wirklich benutzt?
# Aufruf: bash vps-resource-audit.sh
# Macht NUR Reads, keine Aenderungen.

set -u

# Farbcodes
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m'
BLUE='\033[0;34m' ; BOLD='\033[1m' ; RST='\033[0m'

section() { echo -e "\n${BLUE}${BOLD}=== $* ===${RST}"; }
sub()     { echo -e "\n${BOLD}--- $* ---${RST}"; }

echo -e "${BOLD}VPS-Resource-Audit — $(date -Iseconds) — $(hostname)${RST}"

# ═══════════════════════════════════════════════════════════════════
section "1. Top 15 RAM-Verbraucher (Prozesse)"
# RSS = Resident Set Size = wirklich im RAM
ps -eo pid,user,rss,vsz,comm,args --sort=-rss | head -16 | awk '
NR==1 {printf "  %-8s %-10s %-10s %-30s %s\n", $1, $2, "RSS_MB", $5, "CMD"}
NR>1  {rss_mb=$3/1024; cmd=""; for(i=6;i<=NF;i++) cmd=cmd" "$i;
       if(length(cmd)>60) cmd=substr(cmd,1,60)"...";
       printf "  %-8s %-10s %-10.1f %-30s %s\n", $1, $2, rss_mb, $5, cmd}'

# ═══════════════════════════════════════════════════════════════════
section "2. RAM-Verbrauch gruppiert nach systemd-Service"
sub "Per cgroup (systemd-cgls + Memory)"
if command -v systemd-cgtop >/dev/null; then
  # Snapshot, nicht live
  systemd-cgtop --iterations=1 --raw --order=memory 2>/dev/null | head -20 | \
    awk '
    NR==1 || NR==2 {print "  "$0; next}
    {
      # Format: Path  Tasks  %CPU  Memory  ...
      if ($4 ~ /[KMGT]/) {
        printf "  %-60s  RAM=%s\n", substr($1,1,60), $4
      }
    }' | head -20
else
  echo "  systemd-cgtop nicht verfuegbar — ueberspringe"
fi

sub "Summe pro .service"
for svc in $(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}'); do
  # MemoryCurrent fetch — funktioniert nur wenn cgroup-memory aktiv
  memcur=$(systemctl show -p MemoryCurrent "$svc" 2>/dev/null | cut -d= -f2)
  if [[ "$memcur" != "[not set]" && "$memcur" -gt 0 ]] 2>/dev/null; then
    mb=$(( memcur / 1024 / 1024 ))
    if (( mb > 0 )); then
      printf "  %6d MB  %s\n" "$mb" "$svc"
    fi
  fi
done | sort -rn | head -20

# ═══════════════════════════════════════════════════════════════════
section "3. Docker-Container-Uebersicht"
if command -v docker >/dev/null; then
  sub "Alle laufenden Container"
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | head -30
  sub "Memory pro Container (live stats, 1-s-Snapshot)"
  # docker stats mit --no-stream
  docker stats --no-stream --format "  {{.Name}}  CPU={{.CPUPerc}}  MEM={{.MemUsage}}  NET={{.NetIO}}" 2>/dev/null
  sub "Ungenutzte / gestoppte Container (optional entfernen)"
  docker ps -a --filter "status=exited" --format "  {{.Names}}  (exited: {{.Status}})" 2>/dev/null | head -10
  sub "Alle Docker-Images (Groesse)"
  docker image ls --format "  {{.Repository}}:{{.Tag}}  {{.Size}}" 2>/dev/null | sort -k2 -hr | head -15
else
  echo "  (Docker nicht verfuegbar)"
fi

# ═══════════════════════════════════════════════════════════════════
section "4. Listening Ports → Prozess → exe"
# Wer belegt welchen Port
if command -v ss >/dev/null; then
  sub "TCP-Listener mit PID + Prozess"
  sudo -n ss -tlnp 2>/dev/null | awk 'NR>1' | head -20 | sed 's/^/  /'
  if [[ $? -ne 0 ]] || [[ -z "$(sudo -n ss -tlnp 2>/dev/null | head -1)" ]]; then
    echo "  (sudo ohne Passwort nicht moeglich — ohne Root keine PIDs. Ausgabe von ss ohne PID:)"
    ss -tlnp 2>/dev/null | head -20 | sed 's/^/  /'
  fi
fi

# ═══════════════════════════════════════════════════════════════════
section "5. nginx-Sites — wie oft besucht?"
sub "Konfiguration pro Site"
for cfg in /etc/nginx/sites-enabled/*; do
  [[ -L "$cfg" || -f "$cfg" ]] || continue
  name=$(basename "$cfg")
  sn=$(grep -E "^\s*server_name" "$cfg" 2>/dev/null | head -1 | sed 's/^\s*//;s/;$//')
  proxy=$(grep -E "proxy_pass\s+http" "$cfg" 2>/dev/null | head -3 | sed 's/^\s*/      /')
  echo "  ${BOLD}${name}${RST}"
  [[ -n "$sn" ]] && echo "    $sn"
  [[ -n "$proxy" ]] && echo "$proxy"
done

sub "Access-Log-Aktivitaet letzte 7 Tage (falls Logs gedreht sind, nur current)"
# Zahl der Requests pro access log
for log in /var/log/nginx/*access.log /var/log/nginx/*-access.log; do
  [[ -f "$log" && -r "$log" ]] || continue
  count=$(wc -l < "$log" 2>/dev/null || echo 0)
  last=$(tail -1 "$log" 2>/dev/null | awk '{print $4}' | tr -d '[' || echo "?")
  printf "  %-50s  %6d Zeilen  last=%s\n" "$(basename $log)" "$count" "$last"
done 2>/dev/null | head -15

# ═══════════════════════════════════════════════════════════════════
section "6. systemd-Services — letzte Aktivitaet"
sub "Services die Zeit verbraucht haben (journald letzter Monat)"
for svc in nginx matrix-bridge docker; do
  if systemctl is-active "$svc" >/dev/null 2>&1; then
    # Uptime aus ActiveEnterTimestamp
    ts=$(systemctl show -p ActiveEnterTimestamp "$svc" 2>/dev/null | cut -d= -f2)
    echo "  $svc: active seit $ts"
  fi
done

sub "Andere Services mit Port-Binding (vermutete User-Services)"
# Docker-Compose-Instances im System finden
sudo -n find /etc/systemd/system -maxdepth 2 -name "*.service" 2>/dev/null | \
  xargs -I{} basename {} .service 2>/dev/null | head -30 | sed 's/^/  /' || \
  find /etc/systemd/system -maxdepth 2 -name "*.service" 2>/dev/null | head -30 | sed 's/^/  /'

# ═══════════════════════════════════════════════════════════════════
section "7. /opt und /srv — groesste Verzeichnisse"
for base in /opt /srv /var/www /home; do
  if [[ -d "$base" ]]; then
    sub "Groessen in $base"
    sudo -n du -sh "$base"/* 2>/dev/null | sort -hr | head -8 | sed 's/^/  /' || \
    du -sh "$base"/* 2>/dev/null | sort -hr | head -8 | sed 's/^/  /'
  fi
done

# ═══════════════════════════════════════════════════════════════════
section "8. Docker-Compose-Projekte (falls vorhanden)"
# Suche nach docker-compose.yml / compose.yaml
for root in /opt /srv /home /root; do
  if [[ -d "$root" ]]; then
    find "$root" -maxdepth 4 -type f \( -name docker-compose.yml -o -name docker-compose.yaml -o -name compose.yml -o -name compose.yaml \) 2>/dev/null | head -10 | while read f; do
      echo "  Compose-File: $f"
      # Dienste auflisten
      grep -E "^\s{2,4}[a-z0-9_-]+:\s*$" "$f" 2>/dev/null | head -10 | sed 's/^/    service:/'
    done
  fi
done

# ═══════════════════════════════════════════════════════════════════
section "9. Zusammenfassung — was eskalierbar ist"
echo "  (Dieses Fazit wird aus den obigen Daten NICHT automatisch generiert."
echo "   Kopiere bitte alle Ausgaben in den Chat, ich analysiere dann.)"

echo ""
echo -e "${BOLD}=== Audit abgeschlossen ===${RST}"
