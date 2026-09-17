#!/bin/bash
set -euo pipefail

SERVER="${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}"
USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-change-me}"
KCADM=/opt/keycloak/bin/kcadm.sh
export HOME=/tmp

for _ in $(seq 1 60); do
  if "$KCADM" config credentials \
    --server "$SERVER" \
    --realm master \
    --user "$USER" \
    --password "$PASS" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

CID="$("$KCADM" get clients -r ticket-system -q clientId=ticket-staff --fields id 2>/dev/null \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n 1)"

if [ -z "${CID:-}" ]; then
  echo "ticket-staff client not found yet" >&2
  exit 1
fi

"$KCADM" update "clients/$CID" -r ticket-system \
  -s 'redirectUris=["*"]' \
  -s 'webOrigins=["*"]' \
  -s 'attributes."post.logout.redirect.uris"=+'

echo "ticket-staff accepts login from any public host"
