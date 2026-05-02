#!/usr/bin/env bash
# rotate-ai-master-key.sh — generiert einen neuen Pepper fuer
# pgp_sym_encrypt der user_ai_providers.api_key_encrypted-Werte und
# setzt ihn als Postgres-GUC `app.ai_master_key` auf der `postgres`-DB.
#
# Wirkung:
#   - Alle existing user_ai_providers-Records werden geloescht
#     (decrypten gegen den alten Pepper geht nach Rotation nicht).
#   - User muessen ihre API-Keys ueber Admin/Provider-Slots neu eintragen.
#   - Auth + REST-Container werden neu gestartet damit neue Connections
#     den neuen Pepper sehen.
#
# Voraussetzung: supabase_admin-Passwort. Postgres-User darf das GUC
# nicht selbst setzen (CLAUDE.md-Memory).
#
# Aufruf: sudo bash /opt/matrix-repo/infra/scripts/rotate-ai-master-key.sh

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-matrix-supabase-db}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/matrix-repo/infra/supabase}"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
require_cmd docker
require_cmd openssl

echo "=== app.ai_master_key Rotation ==="
echo

# 1. Neuer Pepper generieren — wird NICHT echoed.
NEW_KEY=$(openssl rand -base64 32)
echo "[1/5] Neuer Master-Key generiert (Laenge: ${#NEW_KEY} Zeichen)"

# 2. supabase_admin-Passwort interaktiv lesen (kein Echo).
echo
read -r -s -p "supabase_admin Passwort: " PG_PW
echo
echo

# 3. ALTER DATABASE als supabase_admin via Bind-Mount-Connection.
# psql wird als supabase_admin gestartet, mit PGPASSWORD via env-var.
# -h db.local zwingt TCP statt unix-socket (sonst trust-Auth ohne Pw).
echo "[2/5] Setze GUC auf postgres-DB..."
docker exec -e PGPASSWORD="$PG_PW" "$DB_CONTAINER" \
  psql -U supabase_admin -d postgres -h localhost -v ON_ERROR_STOP=1 \
       -c "ALTER DATABASE postgres SET app.ai_master_key TO '$NEW_KEY';" \
       >/dev/null

unset PG_PW NEW_KEY
echo "[2/5] GUC gesetzt"

# 4. Existing Provider-Records loeschen (decrypten gegen alten Pepper
# geht nicht mehr, also nutzlos).
echo "[3/5] Loesche alte verschluesselte Provider-Records..."
DELETED=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At \
  -c "WITH d AS (DELETE FROM public.user_ai_providers RETURNING 1) SELECT count(*) FROM d;")
echo "[3/5] $DELETED Records geloescht"

# 5. Auth + REST neu starten damit neue Connections den neuen Pepper sehen.
echo "[4/5] Auth + REST restart..."
cd "$COMPOSE_DIR"
docker compose restart auth rest 2>&1 | grep -E 'Restarted|Error' || true
echo "[4/5] Container neu gestartet"

# 6. Verifikation: Function liefert neuen Pepper, kein Fehler.
echo "[5/5] Verifikation..."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres \
  -c "SELECT length(public._ai_master_key()) AS new_pepper_len;"

echo
echo "=== Rotation abgeschlossen ==="
echo "User muessen ihre API-Keys jetzt erneut in Admin/Provider-Slots eintragen."
