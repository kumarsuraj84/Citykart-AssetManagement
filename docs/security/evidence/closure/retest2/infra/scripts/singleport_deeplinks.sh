#!/bin/bash
# CL2-IF item 5 side check: in single-port production mode (FastAPI serves the SPA, FRONTEND_DIST_DIR set) does a
# direct load of the Asset 360 address /assets/<id> -- which is what a printed QR label encodes
# (BASE_URL/assets/{id}, docker-compose.yml comment) -- get the SPA shell? Compared with nginx (3411).
# usage: bash singleport_deeplinks.sh <single-port-base> <nginx-base>
for b in "$1" "$2"; do
  echo "== $b"
  for p in /assets /assets/1 /assets/42 /assets/new "/assets/1?from=qr" /assets/1/ /purchase-orders /people; do
    echo "  $p -> $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$b$p")"
  done
done
