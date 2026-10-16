#!/bin/bash
# CL2-IF headers (AU-14/AU-15/N5/N6/AU-12/FONTS): count every security header on many response kinds.
# usage: bash headers_check.sh <base-url> <label> [js-asset-path] [css-asset-path]
# Prints one block per request: status, then for each header the number of times it occurs and its value(s).
B="$1"; L="$2"; JS="${3:-}"; CSS="${4:-}"
EXPECT_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
EXPECT_PP="camera=(), microphone=(), geolocation=(), payment=(), usb=()"
TMP=$(mktemp -d)
BIG="$TMP/big.json"
# 12 MB JSON body: over nginx's 11m and over the API's own JSON / auth limits.
head -c 12582912 /dev/zero | tr '\0' 'a' | sed 's/^/{"login_id":"x","password":"/; s/$/"}/' > "$BIG"
req() { # name method path [curl args...]
  local name="$1" m="$2" p="$3"; shift 3
  local h="$TMP/h.txt" b="$TMP/b.txt"
  curl -s -o "$b" -D "$h" -X "$m" "$@" "$B$p" >/dev/null
  local st; st=$(head -1 "$h" | tr -d '\r')
  echo "=== [$L] $name  $m $p"
  echo "status: $st"
  echo "content-type: $(grep -i '^content-type:' "$h" | tr -d '\r' | cut -d' ' -f2- | head -1)"
  for k in X-Content-Type-Options X-Frame-Options Referrer-Policy Content-Security-Policy Permissions-Policy Cache-Control X-Request-ID Server Strict-Transport-Security X-Powered-By; do
    local n; n=$(grep -ic "^$k:" "$h")
    local v; v=$(grep -i "^$k:" "$h" | tr -d '\r' | cut -d' ' -f2- | paste -sd'|' -)
    echo "  $k x$n: $v"
  done
  local csp; csp=$(grep -i '^content-security-policy:' "$h" | tr -d '\r' | cut -d' ' -f2- | head -1)
  if [ -n "$csp" ]; then
    if [ "$csp" = "$EXPECT_CSP" ]; then echo "  CSP exact: YES"; else echo "  CSP exact: NO"; fi
    if echo "$csp" | grep -qiE 'google|gstatic'; then echo "  CSP google host: PRESENT"; else echo "  CSP google host: none"; fi
  fi
  local pp; pp=$(grep -i '^permissions-policy:' "$h" | tr -d '\r' | cut -d' ' -f2- | head -1)
  [ -n "$pp" ] && { [ "$pp" = "$EXPECT_PP" ] && echo "  Permissions-Policy exact: YES" || echo "  Permissions-Policy exact: NO"; }
  echo "  body[0..160]: $(head -c 160 "$b" | tr -d '\r\n')"
}
req "root /" GET /
[ -n "$JS" ] && req "real JS asset" GET "$JS"
[ -n "$CSS" ] && req "real CSS asset" GET "$CSS"
req "missing JS asset" GET /assets/does-not-exist-r2c.js
req "missing CSS asset" GET /assets/does-not-exist-r2c.css
req "source map of real asset" GET "${JS:-/assets/index.js}.map"
req "any .map" GET /assets/x.js.map
req "missing font" GET /assets/fonts/nope-r2c.woff2
req "SPA route /assets/42" GET /assets/42
req "SPA route /purchase-orders" GET /purchase-orders
req "SPA route /settings/users" GET /settings/users
req "health" GET /api/health
req "401 no token" GET /api/auth/capabilities
req "401 bad token" GET /api/assets -H "Authorization: Bearer abc.def.ghi"
req "unknown /api path" GET /api/does-not-exist-r2c
req "unknown /api deep" GET /api/x/y/z.css
req "405 wrong method" DELETE /api/health
req "413 12MB sign-in body" POST /api/auth/login -H "Content-Type: application/json" --data-binary "@$BIG"
req "/docs" GET /docs
req "/redoc" GET /redoc
req "/openapi.json" GET /openapi.json
rm -rf "$TMP"
