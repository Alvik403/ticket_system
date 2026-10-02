#!/bin/bash
set -euo pipefail

# Registers ticket-staff redirect URI / web origins in a running Keycloak.
# Re-run after changing PUBLIC_ORIGIN or when using docker-compose on a public IP.
# Realm JSON import runs only once; this updates an existing realm.

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?}"
: "${OIDC_CALLBACK_URL:?}"
: "${STAFF_APP_URL:?}"
: "${PUBLIC_ORIGIN:?}"

kcadm=/opt/keycloak/bin/kcadm.sh
server_url="${KEYCLOAK_SERVER_URL:-http://127.0.0.1:8080}"

"$kcadm" config credentials \
  --server "$server_url" \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

client_id="$(
  "$kcadm" get clients -r ticket-system -q clientId=ticket-staff --fields id \
    | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
)"
if [[ -z "$client_id" ]]; then
  echo "Клиент ticket-staff не найден в realm ticket-system" >&2
  exit 1
fi

staff_base="${STAFF_APP_URL%/}/"
logout_wild="${staff_base}*"

client_file="$(mktemp)"
trap 'rm -f "$client_file"' EXIT
cat > "$client_file" <<EOF
{
  "redirectUris": [
    "${OIDC_CALLBACK_URL}",
    "http://localhost:18080/api/auth/callback",
    "http://127.0.0.1:18080/api/auth/callback",
    "http://localhost:3000/api/auth/callback",
    "http://127.0.0.1:3000/api/auth/callback"
  ],
  "webOrigins": ["+", "${PUBLIC_ORIGIN}"],
  "attributes": {
    "post.logout.redirect.uris": "${staff_base}##${logout_wild}##http://localhost:18080/staff/##http://localhost:18080/staff/*##http://127.0.0.1:18080/staff/*"
  }
}
EOF

echo "Keycloak: redirect ${OIDC_CALLBACK_URL}, origin ${PUBLIC_ORIGIN}"
"$kcadm" update "clients/${client_id}" -r ticket-system --merge -f "$client_file"
