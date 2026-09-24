#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Создайте .env в корне репозитория (см. .env.example)" >&2
  exit 1
fi

for key in POSTGRES_PASSWORD REDIS_PASSWORD SESSION_SECRET OIDC_CLIENT_SECRET KC_BOOTSTRAP_ADMIN_PASSWORD; do
  if ! grep -q "^${key}=.\+" .env; then
    echo "В .env пусто или нет ${key}" >&2
    exit 1
  fi
done

docker compose -f infra/docker-compose.prod.yml --env-file .env up --build -d
docker compose -f infra/docker-compose.prod.yml --env-file .env ps
