#!/usr/bin/env bash
# Wendet alle .sql-Files aus infra/supabase/seed/ an die laufende DB an.
# Im Gegensatz zu migrations/ sind seeds optional und koennen per
# Argument gezielt angesprochen werden.
#
#   bash infra/scripts/supabase-seed.sh             # alle .sql
#   bash infra/scripts/supabase-seed.sh 001_test_tree
#
# Seeds muessen idempotent sein (Check via Alias / Existenz-Query).

set -euo pipefail

GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}   $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; exit 1; }
info() { echo -e "  → $*"; }

SUPABASE_DIR="${SUPABASE_DIR:-/opt/matrix-repo/infra/supabase}"
SEED_DIR="$SUPABASE_DIR/seed"

[[ -d "$SEED_DIR" ]] || fail "Seed-Dir nicht gefunden: $SEED_DIR"

if [[ -f "$SUPABASE_DIR/.env" ]]; then
  set -a
  source "$SUPABASE_DIR/.env"
  set +a
fi

[[ -n "${POSTGRES_PASSWORD:-}" ]] || fail "POSTGRES_PASSWORD nicht gesetzt"

if ! docker compose -f "$SUPABASE_DIR/docker-compose.yml" ps db 2>/dev/null | grep -q "Up"; then
  fail "DB-Container laeuft nicht."
fi

shopt -s nullglob
if [[ $# -ge 1 ]]; then
  FILES=("$SEED_DIR/${1}.sql")
  [[ -f "${FILES[0]}" ]] || fail "Seed nicht gefunden: ${FILES[0]}"
else
  FILES=("$SEED_DIR"/*.sql)
fi

[[ ${#FILES[@]} -gt 0 ]] || { info "Keine Seed-Files. Nichts zu tun."; exit 0; }

echo -e "${YEL}Anwende Seeds aus $SEED_DIR${RST}"
echo ""

for f in "${FILES[@]}"; do
  name=$(basename "$f")
  info "Anwenden: $name"
  if docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T \
       -e "PGPASSWORD=$POSTGRES_PASSWORD" db \
       psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$f" >/tmp/seed.log 2>&1; then
    ok "$name"
    grep -E '^NOTICE' /tmp/seed.log || true
  else
    echo ""
    echo -e "${RED}FEHLER bei $name${RST}"
    echo "----- Log -----"
    tail -30 /tmp/seed.log
    echo "----- /Log -----"
    exit 1
  fi
done

echo ""
echo -e "${GREEN}═══ Seeds fertig ═══${RST}"
