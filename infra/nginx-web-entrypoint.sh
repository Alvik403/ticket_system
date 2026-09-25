#!/bin/sh
set -eu

cert_dir="${NGINX_CERT_DIR:-/etc/nginx/certs}"
mkdir -p "$cert_dir"

if [ ! -s "$cert_dir/fullchain.pem" ] || [ ! -s "$cert_dir/privkey.pem" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$cert_dir/privkey.pem" \
    -out "$cert_dir/fullchain.pem" \
    -subj "/CN=${NGINX_CERT_CN:-ticket-system}"
fi

exec nginx -g 'daemon off;'
