#!/usr/bin/env bash
# setup-vps.sh — Einmalige VPS-Einrichtung (als root ausführen)
# Erstellt Deploy-User, härtet SSH, richtet UFW + fail2ban ein.
#
# Nutzung: ssh root@<vps-ip> 'bash -s' < setup-vps.sh
#
# VORHER: SSH-Public-Key des GitHub-Actions-Runners bereitstellen
#         (wird unten in authorized_keys eingetragen).

set -euo pipefail

echo "=== Deploy-User anlegen ==="
adduser deploy --disabled-password --gecos ""
usermod -aG sudo deploy

# Sudo ohne Passwort für deploy-User (nur Bridge-relevante Befehle)
cat > /etc/sudoers.d/deploy-matrix <<'EOF'
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart matrix-bridge, /bin/systemctl status matrix-bridge, /usr/bin/rsync
EOF
chmod 440 /etc/sudoers.d/deploy-matrix

echo "=== SSH-Key für deploy ==="
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
# HINWEIS: Public Key hier einfügen oder manuell danach
# echo "ssh-ed25519 AAAA... gh-actions@matrix" >> /home/deploy/.ssh/authorized_keys
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

echo "=== SSH härten ==="
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh

echo "=== UFW ==="
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "=== fail2ban ==="
apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban

echo "=== Fertig ==="
echo "Nächster Schritt: install-deps.sh ausführen"
echo "WICHTIG: Public Key für deploy-User in /home/deploy/.ssh/authorized_keys eintragen!"
