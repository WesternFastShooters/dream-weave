#!/bin/sh
set -eu
: "${APP_ORIGIN:?APP_ORIGIN is required}"
: "${DOCUMENT_SERVER_UPSTREAM:?DOCUMENT_SERVER_UPSTREAM is required}"
case "$APP_ORIGIN" in https://*) ;; *) echo 'APP_ORIGIN must be an HTTPS origin' >&2; exit 64;; esac
origin_host=${APP_ORIGIN#https://}
case "$origin_host" in ''|*[/?#@]*|*[!A-Za-z0-9.:-]*) echo 'APP_ORIGIN must not include a path, query, fragment, or credentials' >&2; exit 64;; esac
case "$DOCUMENT_SERVER_UPSTREAM" in *[!A-Za-z0-9.:-]*|*://*|'') echo 'DOCUMENT_SERVER_UPSTREAM must be host:port' >&2; exit 64;; esac
export APP_ORIGIN DOCUMENT_SERVER_UPSTREAM
envsubst '$APP_ORIGIN $DOCUMENT_SERVER_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
