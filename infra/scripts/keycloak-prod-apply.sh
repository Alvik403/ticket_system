#!/bin/bash
set -euo pipefail

# Applies production client URLs and removes imported demo users.
# Safe to re-run. Realm import itself is skipped if the realm already exists.

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?}"
: "${OIDC_CALLBACK_URL:?}"
: "${STAFF_APP_URL:?}"
: "${PUBLIC_ORIGIN:?}"

kcadm=/opt/keycloak/bin/kcadm.sh

echo "Keycloak: вход в master"
"$kcadm" config credentials \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

echo "Keycloak: sslRequired=external"
"$kcadm" update realms/ticket-system -s sslRequired=external

echo "Keycloak: поиск клиента ticket-staff"
client_id="$(
  "$kcadm" get clients -r ticket-system -q clientId=ticket-staff --fields id \
    | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
)"
if [[ -z "$client_id" ]]; then
  echo "Клиент ticket-staff не найден в realm ticket-system" >&2
  exit 1
fi

client_file="$(mktemp)"
trap 'rm -f "$client_file"' EXIT
cat > "$client_file" <<EOF
{
  "redirectUris": ["${OIDC_CALLBACK_URL}"],
  "webOrigins": ["${PUBLIC_ORIGIN}"],
  "attributes": {
    "post.logout.redirect.uris": "${STAFF_APP_URL}"
  }
}
EOF

echo "Keycloak: callback ${OIDC_CALLBACK_URL}"
"$kcadm" update "clients/${client_id}" -r ticket-system --merge -f "$client_file"

demo_emails=(
  admin@example.com
  rf1@example.com
  rf2@example.com
  cn1@example.com
  auditor@example.com
)

for email in "${demo_emails[@]}"; do
  user_id="$(
    "$kcadm" get users -r ticket-system -q "email=${email}" --fields id \
      | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"
  if [[ -n "$user_id" ]]; then
    "$kcadm" delete "users/${user_id}" -r ticket-system
    echo "Удалена демо-учётка ${email}"
  fi
done

if [[ -n "${STAFF_ADMIN_USERNAME:-}" && -n "${STAFF_ADMIN_PASSWORD:-}" ]]; then
  existing_admin="$(
    "$kcadm" get users -r ticket-system -q "username=${STAFF_ADMIN_USERNAME}" --fields id \
      | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"
  if [[ -z "$existing_admin" ]]; then
    "$kcadm" create users -r ticket-system \
      -s "username=${STAFF_ADMIN_USERNAME}" \
      -s enabled=true \
      -s emailVerified=true
    "$kcadm" set-password -r ticket-system \
      --username "$STAFF_ADMIN_USERNAME" \
      --new-password "$STAFF_ADMIN_PASSWORD"
    "$kcadm" add-roles -r ticket-system \
      --uusername "$STAFF_ADMIN_USERNAME" \
      --rolename ADMIN
    echo "Создан администратор ${STAFF_ADMIN_USERNAME}"
  fi
fi
