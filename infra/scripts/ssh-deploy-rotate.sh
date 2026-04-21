#!/usr/bin/env bash
# SSH-Deploy-Rotation — neue Key-Pair fuer GitHub-Actions anlegen,
# altes Chaos in authorized_keys aufraeumen, sshd haerten.
#
# Aufruf AUF DEM VPS als root:
#   bash ssh-deploy-rotate.sh
#
# Gibt am Ende den NEUEN PRIVATE KEY auf stdout aus — den musst du
# 1:1 in GitHub → Settings → Secrets → DEPLOY_SSH_KEY einfuegen.
# Danach ist die Ausgabe geheim — Terminal-Session schliessen!

set -euo pipefail
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'

if [[ $EUID -ne 0 ]]; then
  echo "Bitte als root ausfuehren."
  exit 1
fi

DEPLOY_USER="deploy"
DEPLOY_HOME="/home/$DEPLOY_USER"
AKFILE="$DEPLOY_HOME/.ssh/authorized_keys"
BACKUP="$DEPLOY_HOME/.ssh/authorized_keys.bak.$(date +%s)"

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo -e "${RED}User '$DEPLOY_USER' existiert nicht!${RST}"
  exit 1
fi

echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"
echo " 1. Neues ed25519-Key-Pair generieren (im /root/-tmp)"
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"

TMPKEY="/root/gh-actions-matrix-new"
rm -f "$TMPKEY" "$TMPKEY.pub"
ssh-keygen -t ed25519 -C "gh-actions@matrix-$(date +%Y%m%d)" -f "$TMPKEY" -N ""
echo -e "${GREEN}Generiert: $TMPKEY + $TMPKEY.pub${RST}"

echo ""
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"
echo " 2. Alte authorized_keys sichern + auf den neuen Key reduzieren"
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"

if [[ -f "$AKFILE" ]]; then
  cp "$AKFILE" "$BACKUP"
  echo "Backup: $BACKUP"
fi

# Neue authorized_keys: nur der neue Key + ein Kommentar.
# Falls du dir zusaetzlich einen Admin-Key reinlegen willst, danach manuell anhaengen.
mkdir -p "$DEPLOY_HOME/.ssh"
cat "$TMPKEY.pub" > "$AKFILE"
chmod 600 "$AKFILE"
chmod 700 "$DEPLOY_HOME/.ssh"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
echo -e "${GREEN}authorized_keys enthaelt jetzt NUR den neuen Deploy-Key:${RST}"
awk '{print "  " $NF}' "$AKFILE"

echo ""
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"
echo " 3. sshd-Haertung:"
echo "    - PasswordAuthentication: no"
echo "    - PermitRootLogin:        prohibit-password"
echo "    (Key-Auth bleibt fuer root, Brute-Force auf root ist tot)"
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"

HARDEN_CONF="/etc/ssh/sshd_config.d/99-matrix-harden.conf"
cat > "$HARDEN_CONF" <<EOF
# Matrix-VPS-Haertung — sparate drop-in-Datei, ueberschreibt aeltere Werte.
# Wiederaktivierung per Loeschen dieser Datei + sshd-reload.

# Kein Passwort-Login mehr
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no

# Root darf noch via Key, aber nicht mit Passwort
PermitRootLogin prohibit-password
EOF
echo -e "${GREEN}sshd-Config geschrieben: $HARDEN_CONF${RST}"

# sshd-Config validieren VOR Restart
echo ""
echo "sshd-Config-Test:"
if sshd -t; then
  echo -e "  ${GREEN}Config gueltig${RST}"
else
  echo -e "  ${RED}Config UNGUELTIG — Aenderungen rueckgaengig machen:${RST}"
  echo "    rm $HARDEN_CONF && systemctl reload ssh"
  exit 1
fi

# Reload (kein Restart, damit laufende Sessions bleiben)
echo ""
read -r -p "sshd jetzt reloaden? (bestehende Sessions bleiben) [y/N] " ans
if [[ "${ans,,}" == "y" ]]; then
  systemctl reload ssh
  echo -e "${GREEN}sshd reloaded.${RST}"
else
  echo "Skipped. Manueller Reload: systemctl reload ssh"
fi

echo ""
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"
echo -e " 4. ${RED}PRIVATE KEY AUSGABE${RST}${YEL} — jetzt in GitHub-Secret einsetzen${RST}"
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"
echo ""
echo "GitHub → Settings → Secrets and variables → Actions"
echo "→ Secret 'DEPLOY_SSH_KEY' bearbeiten → kompletten Inhalt ersetzen durch:"
echo ""
echo -e "${RED}--- CUT HERE ---${RST}"
cat "$TMPKEY"
echo -e "${RED}--- CUT HERE ---${RST}"
echo ""
echo "Der Private-Key ist NICHT auf dem VPS gespeichert — er liegt nur in /root/gh-actions-matrix-new."
echo "Loesch ihn nach dem Einfuegen in GitHub:"
echo ""
echo "  shred -u $TMPKEY $TMPKEY.pub"
echo ""
echo "Danach: GitHub-Action erneut triggern (Re-Run oder neuer push)."
echo ""
echo -e "${YEL}═══════════════════════════════════════════════════════════${RST}"

# Falls DEPLOY_KNOWN_HOSTS-Secret geprueft werden soll
echo ""
echo "Check: DEPLOY_KNOWN_HOSTS-Secret sollte diesen Host-Key enthalten:"
ssh-keyscan -t ed25519 -H "$(hostname -f 2>/dev/null || hostname)" 2>/dev/null || \
  echo "  (ssh-keyscan des eigenen Hosts fehlgeschlagen — Keine Sorge wenn DEPLOY_KNOWN_HOSTS weiterhin funktioniert)"
