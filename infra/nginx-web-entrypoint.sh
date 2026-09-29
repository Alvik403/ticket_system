#!/bin/sh
set -eu

cert_dir="${NGINX_CERT_DIR:-/etc/nginx/certs}"

if [ "${REQUIRE_TLS_CERTS:-false}" = "true" ]; then
  if [ ! -s "$cert_dir/fullchain.pem" ] || [ ! -s "$cert_dir/privkey.pem" ]; then
    echo "Нужны доверенные TLS-файлы fullchain.pem и privkey.pem в infra/certs" >&2
    exit 1
  fi
fi

exec nginx -g 'daemon off;'
