#!/usr/bin/env bash
# Wendet alle SQL-Migrations in infra/supabase/migrations/ in alphabetischer
# Reihenfolge gegen die laufende Supabase-DB an.
#
# Aufruf AUF DEM VPS:
#   cd /opt/matrix-repo
#   bash infra/scripts/supabase-migrate.sh
#
# Migrations sollen idempotent sein — erneuter Aufruf darf nichts beschaedigen.
#
# Im Gegensatz zu volumes/db/init/*.sql (nur beim allerersten DB-Start)
# laufen migrations/*.sql bei jedem Aufruf. Sie sind die dev-freundliche
# Variante: Schema erweitern, ohne DB-Volume wegwerfen zu muessen.

set -euo pipefail

GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}   $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; exit 1; }
info() { echo -e "  → $*"; }

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"
MIGRATIONS_DIR="$SUPABASE_DIR/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  fail "Migrations-Dir nicht gefunden: $MIGRATIONS_DIR"
fi

# .env einlesen fuer POSTGRES_PASSWORD
if [[ -f "$SUPABASE_DIR/.env" ]]; then
  set -a
  source "$SUPABASE_DIR/.env"
  set +a
fi

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  fail "POSTGRES_PASSWORD nicht gesetzt (aus .env oder ENV)"
fi

# Container-Check
if ! docker compose -f "$SUPABASE_DIR/docker-compose.yml" ps db 2>/dev/null | grep -q "Up"; then
  fail "DB-Container laeuft nicht. Stack starten mit: docker compose up -d"
fi

echo -e "${YEL}Anwende Migrations aus $MIGRATIONS_DIR${RST}"
echo ""

# Migrations-Output landet im temporaeren Logfile mit mode 0600 (mktemp-
# Default). KEIN /tmp/migrate.log — das war world-readable und konnte
# bei einer fehlgeschlagenen Migration mit psql-Stderr Pfade,
# DB-Inhalts-Snippets oder Verbindungsstrings durchreichen. Auf einem
# Multi-User-VPS Information-Disclosure (ASVS V8.3.4 / V14.4.1).
LOGFILE=$(mktemp -t matrix-migrate.XXXXXX)
trap 'rm -f "$LOGFILE"' EXIT

shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)
if [[ ${#FILES[@]} -eq 0 ]]; then
  info "Keine .sql-Files in $MIGRATIONS_DIR — nichts zu tun."
  exit 0
fi

for f in "${FILES[@]}"; do
  name=$(basename "$f")
  info "Anwenden: $name"
  # psql via docker exec; PGPASSWORD als Env-Variable
  if docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" db \
       psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$f" > "$LOGFILE" 2>&1; then
    ok "$name"
  else
    echo ""
    echo -e "${RED}FEHLER bei $name${RST}"
    echo "----- Log -----"
    tail -30 "$LOGFILE"
    echo "----- /Log -----"
    exit 1
  fi
done

echo ""
echo -e "${GREEN}═══ Alle Migrations erfolgreich angewendet ═══${RST}"
