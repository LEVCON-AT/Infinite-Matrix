#!/usr/bin/env bash
# Erzeugt ANON_KEY + SERVICE_ROLE_KEY fuer Supabase, signiert mit JWT_SECRET.
#
# Aufruf:   bash supabase-genkeys.sh [JWT_SECRET]
#   - ohne Arg: liest JWT_SECRET aus infra/supabase/.env
#   - mit Arg:  benutzt das Argument
#
# Output: die beiden fertigen JWTs. Kopieren in .env → ANON_KEY / SERVICE_ROLE_KEY.

set -u

ENV_FILE="$(dirname "$0")/../supabase/.env"

if [[ $# -ge 1 ]]; then
  JWT_SECRET="$1"
elif [[ -f "$ENV_FILE" ]]; then
  JWT_SECRET=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
else
  echo "Kein JWT_SECRET: weder Argument noch $ENV_FILE gefunden."
  exit 1
fi

if [[ -z "$JWT_SECRET" || ${#JWT_SECRET} -lt 32 ]]; then
  echo "JWT_SECRET zu kurz oder leer (min. 32 Zeichen). Generiere eins mit:"
  echo "  openssl rand -base64 40"
  exit 1
fi

# Standardisierte Supabase-Claims, ablaufend 2036
IAT=$(date +%s)
EXP=$((IAT + 10 * 365 * 24 * 3600))  # ~10 Jahre — fuer staging OK

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

sign() {
  local header_b64 payload_b64 sig
  header_b64=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload_b64=$(printf '%s' "$1" | b64url)
  sig=$(printf '%s.%s' "$header_b64" "$payload_b64" \
    | openssl dgst -binary -sha256 -hmac "$JWT_SECRET" \
    | b64url)
  echo "${header_b64}.${payload_b64}.${sig}"
}

ANON_PAYLOAD="{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}"
SERVICE_PAYLOAD="{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}"

ANON_KEY=$(sign "$ANON_PAYLOAD")
SERVICE_KEY=$(sign "$SERVICE_PAYLOAD")

echo ""
echo "════════════════════════════════════════════════════════════"
echo " In .env kopieren:"
echo "════════════════════════════════════════════════════════════"
echo "ANON_KEY=${ANON_KEY}"
echo ""
echo "SERVICE_ROLE_KEY=${SERVICE_KEY}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Ablauf: $(date -d @${EXP} 2>/dev/null || date -r ${EXP}) (~10 Jahre)"
