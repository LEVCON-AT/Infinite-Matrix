#!/usr/bin/env bash
# sync-auth-providers.sh — liest Provider-Slot-Configs aus
# public.system_config und schreibt sie als GOTRUE_EXTERNAL_*-env-Vars
# in /opt/matrix-repo/infra/supabase/.env.providers. Triggert auth-
# Container-Restart wenn sich etwas geaendert hat.
#
# Wird VOM ROOT auf dem VPS gerufen, nach jedem Save in der Admin-UI:
#   sudo bash /opt/matrix-repo/infra/scripts/sync-auth-providers.sh
#
# Idempotent: wenn nichts neu, kein Restart. Aufruf in Cron alle 5 min
# als V2 moeglich.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/matrix-repo}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/infra/supabase/.env}"
ENV_BAK="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
DB_CONTAINER="${DB_CONTAINER:-matrix-supabase-db}"
COMPOSE_DIR="$REPO_ROOT/infra/supabase"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_cmd docker
require_cmd jq

# Liest auth.providers.{provider}.value (jsonb) aus system_config.
# Returns JSON-Objekt {google: {...}, microsoft: {...}, ...} oder {}.
fetch_providers() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c "
    SELECT COALESCE(jsonb_object_agg(
      replace(key, 'auth.providers.', ''),
      value
    ), '{}'::jsonb)::text
    FROM public.system_config
    WHERE key LIKE 'auth.providers.%';
  " 2>/dev/null
}

PROVIDERS_JSON="$(fetch_providers)"
if [[ -z "$PROVIDERS_JSON" || "$PROVIDERS_JSON" == "{}" ]]; then
  echo "[sync] keine Provider-Configs in system_config — nichts zu tun"
  exit 0
fi

# Aus JSON-Object pro Provider-Kind die env-Vars bauen.
build_env() {
  local prov="$1"  # google | microsoft | github | linkedin
  local data
  data=$(echo "$PROVIDERS_JSON" | jq -c ".${prov} // null")
  if [[ "$data" == "null" ]]; then return 0; fi
  local enabled client_id client_secret tenant_id
  enabled=$(echo "$data" | jq -r '.enabled // false')
  client_id=$(echo "$data" | jq -r '.client_id // ""')
  client_secret=$(echo "$data" | jq -r '.client_secret // ""')

  # Empty-Provider (alle Felder leer) NICHT enablen — sonst meldet
  # GoTrue beim Boot "missing client_id".
  if [[ -z "$client_id" || -z "$client_secret" ]]; then
    enabled="false"
  fi

  case "$prov" in
    google)
      echo "ENABLE_GOOGLE_OAUTH=$enabled"
      echo "GOOGLE_CLIENT_ID=$client_id"
      echo "GOOGLE_CLIENT_SECRET=$client_secret"
      ;;
    microsoft)
      tenant_id=$(echo "$data" | jq -r '.tenant_id // "common"')
      echo "ENABLE_AZURE_OAUTH=$enabled"
      echo "AZURE_CLIENT_ID=$client_id"
      echo "AZURE_SECRET=$client_secret"
      echo "AZURE_URL=https://login.microsoftonline.com/${tenant_id}/v2.0"
      ;;
    github)
      echo "ENABLE_GITHUB_OAUTH=$enabled"
      echo "GITHUB_CLIENT_ID=$client_id"
      echo "GITHUB_SECRET=$client_secret"
      ;;
    linkedin)
      echo "ENABLE_LINKEDIN_OIDC=$enabled"
      echo "LINKEDIN_OIDC_CLIENT_ID=$client_id"
      echo "LINKEDIN_OIDC_SECRET=$client_secret"
      ;;
  esac
}

# Build new env-Snippet.
NEW_BLOCK=$({
  echo "# ─── Auto-Sync aus public.system_config (sync-auth-providers.sh) ─"
  echo "# Stand: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_env google
  build_env microsoft
  build_env github
  build_env linkedin
})

# Aktuelle ENV minus alten Auto-Sync-Block lesen (idempotent).
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

# Strippe alten Auto-Sync-Block (von Marker-Comment bis naechster
# leerer Zeile / EOF).
awk '
  BEGIN { skip=0 }
  /^# ─── Auto-Sync aus public.system_config/ { skip=1; next }
  skip == 1 && /^[[:space:]]*$/ { skip=0; next }
  skip == 1 { next }
  { print }
' "$ENV_FILE" > "$TMP_ENV"

# Append neuen Block + leerzeile.
echo "" >> "$TMP_ENV"
echo "$NEW_BLOCK" >> "$TMP_ENV"
echo "" >> "$TMP_ENV"

# Diff-Check: nur wenn sich etwas geaendert hat → Schreiben + Restart.
if cmp -s "$ENV_FILE" "$TMP_ENV"; then
  echo "[sync] keine Aenderungen"
  exit 0
fi

cp "$ENV_FILE" "$ENV_BAK"
mv "$TMP_ENV" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "[sync] .env aktualisiert (Backup: $ENV_BAK)"

# Auth-Container neustarten.
cd "$COMPOSE_DIR"
docker compose up -d --force-recreate auth 2>&1 | tail -5
echo "[sync] auth-Container neu gestartet"
