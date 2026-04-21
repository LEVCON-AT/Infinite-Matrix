#!/usr/bin/env bash
# SSH-Deploy-Check — diagnostiziert, warum GitHub-Actions-Deploy keine SSH-Verbindung kriegt.
# Aufruf AUF DEM VPS, als Root oder mit sudo.
#
# Gibt aus: welcher User soll deployen, liegt der Public-Key drin, passt sshd-Config.

set -u
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}   $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; }
warn() { echo -e "${YEL}[WARN]${RST} $*"; }
info() { echo "  → $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Bitte als root/sudo — muss in andere User-Home-Dirs lesen."
  exit 1
fi

echo "════════════════════════════════════════════════"
echo " SSH-Deploy-Diagnostic — $(date -Iseconds)"
echo "════════════════════════════════════════════════"

# 1. Welche User haben .ssh-Dirs?
echo ""
echo "--- 1. Alle User mit .ssh-Verzeichnis ---"
for home in /root /home/*; do
  if [[ -d "$home/.ssh" ]]; then
    user=$(basename "$home")
    [[ "$user" == "home" ]] && continue
    [[ "$home" == "/root" ]] && user="root"
    akfile="$home/.ssh/authorized_keys"
    if [[ -f "$akfile" ]]; then
      keycount=$(wc -l < "$akfile")
      # Hash der Keys fuer Verifikation (ohne Key-Inhalt zu leaken)
      echo "  $user: $keycount Keys in authorized_keys"
      # Key-Kommentare (letzter Wortteil nach Space) — zeigt Key-Ursprung
      awk '{n=NF; print "    #" $n}' "$akfile" 2>/dev/null | head -10
    else
      echo "  $user: .ssh vorhanden, aber keine authorized_keys"
    fi
  fi
done

# 2. sshd-Konfiguration
echo ""
echo "--- 2. sshd-Konfig (wichtigste Flags) ---"
if [[ -f /etc/ssh/sshd_config ]]; then
  grep -E "^\s*(PubkeyAuthentication|PasswordAuthentication|PermitRootLogin|AuthorizedKeysFile|AllowUsers|DenyUsers)" /etc/ssh/sshd_config | sed 's/^/  /'
  # Auch drop-in-Configs
  for f in /etc/ssh/sshd_config.d/*.conf; do
    [[ -f "$f" ]] || continue
    echo "  -- $f --"
    grep -E "^\s*(PubkeyAuthentication|PasswordAuthentication|PermitRootLogin|AuthorizedKeysFile|AllowUsers|DenyUsers)" "$f" 2>/dev/null | sed 's/^/    /'
  done
fi

# 3. Faktisches sshd-Verhalten
echo ""
echo "--- 3. Effektive sshd-Defaults (sshd -T) ---"
sshd -T 2>/dev/null | grep -E "^(pubkeyauthentication|passwordauthentication|permitrootlogin|authorizedkeysfile|allowusers|denyusers|challengeresponseauthentication|usepam)" | sed 's/^/  /'

# 4. sshd-Service-Status
echo ""
echo "--- 4. sshd-Service ---"
systemctl status ssh --no-pager -l 2>&1 | head -10 | sed 's/^/  /'

# 5. Letzte SSH-Login-Versuche (journalctl)
echo ""
echo "--- 5. Letzte 10 SSH-Auth-Events (journalctl) ---"
journalctl -u ssh --no-pager -n 50 2>/dev/null | grep -E "Accepted|Failed|Invalid|publickey|authentication" | tail -10 | sed 's/^/  /'

# 6. UFW
echo ""
echo "--- 6. UFW-Regeln ---"
ufw status 2>/dev/null | head -15 | sed 's/^/  /'

# 7. Fail2ban-Status (falls SSH-bans)
echo ""
echo "--- 7. Fail2ban ---"
if command -v fail2ban-client >/dev/null; then
  fail2ban-client status 2>/dev/null | sed 's/^/  /'
  fail2ban-client status sshd 2>/dev/null | sed 's/^/  /' | head -20
fi

echo ""
echo "════════════════════════════════════════════════"
echo " Ausgabe fertig — bitte an Claude schicken"
echo "════════════════════════════════════════════════"
