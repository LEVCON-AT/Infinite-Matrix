#!/usr/bin/env bash
# AU-B1 K6 (B1-G-001): einmaliges Setup des Postgres-GUC `app.ai_master_key`.
#
# Migration 018_user_ai_providers.sql erwartet `current_setting('app.ai_master_key', true)`
# > 16 Zeichen. Wird der GUC nicht gesetzt, schlaegt jeder Aufruf von
# `set_ai_provider()` / `get_my_provider_credential()` mit Exception
# `ai_master_key_missing` fehl — und der Frontend-User sieht uninformative
# Fehler.
#
# ALTER DATABASE … SET ist persistent ueber Postgres-Restarts hinweg.
# Wird die DB jedoch ge-cleared (Volume-Wipe), muss das Skript erneut
# laufen. Idempotent: erneuter Aufruf ueberschreibt den Wert (nicht
# spuelt — daher kein Datenverlust).
#
# Aufruf AUF DEM VPS:
#   cd /opt/matrix-repo
#   bash infra/scripts/supabase-setup-ai-master-key.sh
#
# Liest AI_MASTER_KEY aus .env. Falls leer, wird abgebrochen mit Hinweis
# auf openssl-Befehl.

set -euo pipefail

GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}   $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; exit 1; }
info() { echo -e "  → $*"; }

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"

if [[ -f "$SUPABASE_DIR/.env" ]]; then
  set -a
  source "$SUPABASE_DIR/.env"
  set +a
fi

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  fail "POSTGRES_PASSWORD nicht gesetzt (aus .env oder ENV)"
fi

if [[ -z "${AI_MASTER_KEY:-}" ]]; then
  echo -e "${RED}AI_MASTER_KEY nicht gesetzt.${RST}"
  echo ""
  echo "Schritt 1: Generieren"
  echo "  openssl rand -base64 32"
  echo ""
  echo "Schritt 2: In .env eintragen (AI_MASTER_KEY=...)"
  echo ""
  echo "Schritt 3: Dieses Skript erneut laufen lassen."
  exit 1
fi

if [[ ${#AI_MASTER_KEY} -lt 16 ]]; then
  fail "AI_MASTER_KEY zu kurz (${#AI_MASTER_KEY} Zeichen, mind. 16). Generieren mit: openssl rand -base64 32"
fi

# Container-Check
if ! docker compose -f "$SUPABASE_DIR/docker-compose.yml" ps db 2>/dev/null | grep -q "Up"; then
  fail "DB-Container laeuft nicht. Stack starten mit: docker compose up -d"
fi

echo -e "${YEL}Setze app.ai_master_key auf der DB${RST}"

# ALTER DATABASE … SET — persistent ueber Postgres-Restarts.
# psql-Quoting fuer SQL-Identifiers: einfache Quotes um den Wert,
# eingebettete Single-Quotes per Doppelung escapen.
ESCAPED_KEY=${AI_MASTER_KEY//\'/\'\'}

if docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T \
     -e "PGPASSWORD=$POSTGRES_PASSWORD" db \
     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
     -c "ALTER DATABASE postgres SET app.ai_master_key = '$ESCAPED_KEY';" \
     >/dev/null 2>&1; then
  ok "GUC gesetzt"
else
  fail "ALTER DATABASE fehlgeschlagen — postgres-User vorhanden?"
fi

# Re-Validation: GUC kann erst nach reconnect gelesen werden.
# Postgres-Session-Restart ist normalerweise nicht noetig, da neue
# Connections die per-Database-GUC schon sehen. Aber zur Sicherheit
# einen Test-Call machen.
info "Verifiziere via _ai_master_key()..."
if docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T \
     -e "PGPASSWORD=$POSTGRES_PASSWORD" db \
     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
     -c "SELECT length(public._ai_master_key()) AS key_len;" \
     2>&1 | grep -q "key_len"; then
  ok "_ai_master_key() liefert Wert zurueck"
else
  echo -e "${YEL}Hinweis:${RST} _ai_master_key() funktioniert evtl. erst nach Postgres-Container-Restart."
  echo "  docker compose restart db"
fi

echo ""
echo -e "${GREEN}═══ AI-Master-Key Setup abgeschlossen ═══${RST}"
