#!/usr/bin/env bash
# Supabase-Stack-Deploy — interaktiv, idempotent, Schritt fuer Schritt.
# Aufruf AUF DEM VPS als root:
#   bash supabase-deploy.sh
#
# Voraussetzungen:
#   - Docker + docker compose installiert (bereits vorhanden)
#   - /opt/supabase/ Verzeichnis, docker-compose.yml + volumes + .env darin
#   - .env ausgefuellt (insb. Keys aus supabase-genkeys.sh)

set -u
GREEN='\033[0;32m' ; RED='\033[0;31m' ; YEL='\033[1;33m'
BLUE='\033[0;34m' ; BOLD='\033[1m' ; RST='\033[0m'
ok()   { echo -e "${GREEN}[OK]${RST}   $*"; }
fail() { echo -e "${RED}[FAIL]${RST} $*"; exit 1; }
warn() { echo -e "${YEL}[WARN]${RST} $*"; }
info() { echo -e "${BLUE}→${RST} $*"; }

ask() {
  echo ""
  echo -e "${YEL}${BOLD}▶ $1${RST}"
  read -r -p "  Ausfuehren? [y/N/q=quit] " ans
  case "${ans,,}" in
    y|yes|j|ja) return 0 ;;
    q|quit) echo "Abgebrochen."; exit 0 ;;
    *) echo "  ↳ uebersprungen."; return 1 ;;
  esac
}

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"

if [[ $EUID -ne 0 ]]; then
  fail "Bitte als root starten."
fi

echo -e "${BLUE}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo " Matrix-Supabase-Stack — Interaktiver Deploy"
echo " SUPABASE_DIR=$SUPABASE_DIR"
echo "═══════════════════════════════════════════════════════════"
echo -e "${RST}"

# ─── 1. Vorbedingungen ────────────────────────────────────────
info "Pruefe Voraussetzungen…"
command -v docker >/dev/null || fail "docker nicht installiert"
docker compose version >/dev/null || fail "docker compose plugin fehlt"
[[ -d "$SUPABASE_DIR" ]] || fail "$SUPABASE_DIR nicht vorhanden — zuerst mit rsync befuellen"
[[ -f "$SUPABASE_DIR/docker-compose.yml" ]] || fail "docker-compose.yml fehlt in $SUPABASE_DIR"
[[ -f "$SUPABASE_DIR/.env" ]] || fail ".env fehlt in $SUPABASE_DIR — zuerst aus .env.example kopieren + ausfuellen"
ok "Voraussetzungen erfuellt"

# ─── 2. .env-Validierung ──────────────────────────────────────
info "Validiere .env-Felder…"
source "$SUPABASE_DIR/.env"

[[ "${POSTGRES_PASSWORD:-}" =~ [A-Z] && "${POSTGRES_PASSWORD:-}" =~ [0-9] && ${#POSTGRES_PASSWORD} -ge 20 ]] \
  || fail "POSTGRES_PASSWORD zu schwach (min. 20 Zeichen, gross+Zahlen)"
[[ ${#JWT_SECRET} -ge 32 ]] || fail "JWT_SECRET zu kurz"
[[ -n "${ANON_KEY:-}" ]] || fail "ANON_KEY leer — mit supabase-genkeys.sh generieren"
[[ -n "${SERVICE_ROLE_KEY:-}" ]] || fail "SERVICE_ROLE_KEY leer"
[[ ${#SECRET_KEY_BASE} -ge 32 ]] || fail "SECRET_KEY_BASE zu kurz (openssl rand -hex 32)"
[[ -n "${SMTP_PASS:-}" ]] || warn "SMTP_PASS leer — Magic-Links werden nicht versendet"
ok ".env plausibel"

# ─── 3. Daten-Verzeichnisse + Rechte ─────────────────────────
info "Erstelle/pruefe Daten-Verzeichnisse…"
for d in volumes/db/data volumes/db/init volumes/db/logs; do
  mkdir -p "$SUPABASE_DIR/$d"
done
# Postgres-Data muss 999:999 (postgres-UID im Image) gehoeren
if [[ "$(stat -c '%u' "$SUPABASE_DIR/volumes/db/data")" != "999" ]]; then
  chown -R 999:999 "$SUPABASE_DIR/volumes/db/data"
fi
ok "Verzeichnisse OK"

# ─── 4. Images pullen ─────────────────────────────────────────
if ask "Docker-Images pullen (kann ~1 GB Traffic bedeuten)?"; then
  cd "$SUPABASE_DIR"
  docker compose pull 2>&1 | tail -20
  ok "Images da"
fi

# ─── 5. DB zuerst starten ─────────────────────────────────────
if ask "Stack starten? (db zuerst, dann Rest wenn db healthy)"; then
  cd "$SUPABASE_DIR"
  info "Starte Vector + DB…"
  docker compose up -d vector db
  # Auf healthy warten
  info "Warte auf db health (max 60 s)…"
  for i in {1..30}; do
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' matrix-supabase-db 2>/dev/null || echo none)" == "healthy" ]]; then
      ok "db healthy"
      break
    fi
    sleep 2
  done
  info "Starte auth, rest, realtime, kong…"
  docker compose up -d
  ok "Stack laeuft"
fi

# ─── 6. Status-Report ─────────────────────────────────────────
echo ""
info "Container-Status:"
docker compose ps 2>&1 | tail -12
echo ""
info "Memory-Verbrauch:"
docker stats --no-stream --format "  {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" $(docker compose ps -q) 2>/dev/null
echo ""

# ─── 7. Healthcheck ───────────────────────────────────────────
info "Healthchecks (via Kong, lokal)…"
KONG_PORT=${KONG_HTTP_PORT:-8000}
(curl -sfS "http://127.0.0.1:${KONG_PORT}/auth/v1/health" && echo) \
  && ok "auth erreichbar" || warn "auth-Healthcheck fehlgeschlagen"
(curl -sfS -H "apikey: $ANON_KEY" "http://127.0.0.1:${KONG_PORT}/rest/v1/" >/dev/null && echo OK) \
  && ok "rest erreichbar" || warn "rest-Healthcheck fehlgeschlagen (evtl. noch beim Hochfahren)"

echo ""
echo -e "${GREEN}${BOLD}═══ Deploy fertig ═══${RST}"
echo "Kong-Endpoint (nur lokal): http://127.0.0.1:${KONG_PORT}/"
echo ""
echo "Naechste Schritte:"
echo "  1. nginx: staging.matrix.levcon.at → 127.0.0.1:${KONG_PORT} (siehe infra/nginx/)"
echo "  2. Studio starten wenn noetig: cd $SUPABASE_DIR && docker compose --profile admin up -d"
echo "     Zugriff via SSH-Tunnel: ssh -L 3002:127.0.0.1:3002 vps → http://localhost:3002"
