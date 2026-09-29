#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Создайте .env в корне репозитория (см. .env.example)" >&2
  exit 1
fi

env_value() {
  local key=$1
  local line
  line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

for key in POSTGRES_PASSWORD REDIS_PASSWORD SESSION_SECRET OIDC_CLIENT_SECRET KC_BOOTSTRAP_ADMIN_PASSWORD PUBLIC_ORIGIN; do
  if [[ -z "$(env_value "$key")" ]]; then
    echo "В .env пусто или нет ${key}" >&2
    exit 1
  fi
done

PUBLIC_ORIGIN="$(env_value PUBLIC_ORIGIN)"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"
if [[ ! "$PUBLIC_ORIGIN" =~ ^https://[^/]+$ ]]; then
  echo "PUBLIC_ORIGIN должен быть вида https://queue.example.ru без пути" >&2
  exit 1
fi

OIDC_ISSUER="$(env_value OIDC_ISSUER)"
OIDC_CALLBACK_URL="$(env_value OIDC_CALLBACK_URL)"
STAFF_APP_URL="$(env_value STAFF_APP_URL)"
CLIENT_ORIGIN="$(env_value CLIENT_ORIGIN)"
STAFF_ORIGIN="$(env_value STAFF_ORIGIN)"

: "${OIDC_ISSUER:=${PUBLIC_ORIGIN}/realms/ticket-system}"
: "${OIDC_CALLBACK_URL:=${PUBLIC_ORIGIN}/api/auth/callback}"
: "${STAFF_APP_URL:=${PUBLIC_ORIGIN}/staff/}"
: "${CLIENT_ORIGIN:=${PUBLIC_ORIGIN}}"
: "${STAFF_ORIGIN:=${PUBLIC_ORIGIN}}"

export PUBLIC_ORIGIN OIDC_ISSUER OIDC_CALLBACK_URL STAFF_APP_URL CLIENT_ORIGIN STAFF_ORIGIN
export COOKIE_SECURE=true ALLOW_LOCALHOST_CORS=false

cert_dir=infra/certs
if [[ ! -s "$cert_dir/fullchain.pem" || ! -s "$cert_dir/privkey.pem" ]]; then
  echo "Положите доверенные TLS-файлы в ${cert_dir}/fullchain.pem и ${cert_dir}/privkey.pem" >&2
  exit 1
fi

compose=(docker compose -f infra/docker-compose.prod.yml --env-file .env)

# Build one image at a time: parallel npm/JVM builds can exhaust a 2 GB host.
"${compose[@]}" build keycloak
"${compose[@]}" build api
"${compose[@]}" build web
"${compose[@]}" up --no-build -d --wait
"${compose[@]}" exec -T keycloak /opt/keycloak/keycloak-prod-apply.sh
"${compose[@]}" ps
