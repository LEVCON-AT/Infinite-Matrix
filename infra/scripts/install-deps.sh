#!/usr/bin/env bash
# install-deps.sh — Installiert Node 22, pnpm, nginx, SQLite, certbot
# Als root auf dem VPS ausführen, nach setup-vps.sh.
#
# Nutzung: ssh root@<vps-ip> 'bash -s' < install-deps.sh

set -euo pipefail

echo "=== Node 22 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo "=== pnpm via corepack ==="
corepack enable
corepack prepare pnpm@9 --activate

echo "=== nginx ==="
apt install -y nginx

echo "=== SQLite CLI ==="
apt install -y sqlite3

echo "=== certbot + nginx-Plugin ==="
apt install -y certbot python3-certbot-nginx

echo "=== Service-User für Bridge ==="
useradd -r -s /usr/sbin/nologin -d /opt/matrix-bridge matrix-bridge || true

echo "=== Verzeichnisse ==="
mkdir -p /opt/matrix-bridge/data
chown -R matrix-bridge:matrix-bridge /opt/matrix-bridge
mkdir -p /var/www/matrix
chown -R deploy:deploy /var/www/matrix

echo "=== Versions-Check ==="
node -v
pnpm -v
nginx -v
sqlite3 --version
certbot --version

echo ""
echo "=== Fertig ==="
echo "Nächster Schritt:"
echo "  1. .env anlegen:  sudo -u matrix-bridge nano /opt/matrix-bridge/.env"
echo "  2. Token:         openssl rand -hex 32"
echo "  3. systemd-Unit:  cp infra/systemd/matrix-bridge.service /etc/systemd/system/"
echo "  4. nginx-Config:  cp infra/nginx/matrix.conf /etc/nginx/sites-available/"
echo "  5. TLS:           certbot --nginx -d matrix.levcon.at"
