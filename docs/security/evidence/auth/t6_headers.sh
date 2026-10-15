#!/usr/bin/env bash
API=http://127.0.0.1:8200
WEB=http://localhost:3411
show(){ echo "### $1 $2"; curl -s -D - -o /dev/null -X "${3:-GET}" "$2" ${4:+$4} | tr -d '\r' | grep -iE '^(HTTP/|server:|x-content-type|x-frame|referrer-policy|cache-control|content-security|permissions-policy|strict-transport|x-request-id|x-powered|access-control|allow:)' ; echo; }

echo "===== API 8200 ====="
show API-health "$API/api/health"
show API-openapi "$API/openapi.json"
show API-docs "$API/docs"
show API-404 "$API/api/nope"
show API-login-POST "$API/api/auth/login" POST "-H Content-Type:application/json"

echo "===== WEB 3411 (nginx) ====="
show WEB-root "$WEB/"
show WEB-index "$WEB/index.html"
show WEB-apihealth "$WEB/api/health"
show WEB-404spa "$WEB/some/spa/route"
show WEB-dotenv "$WEB/.env"
show WEB-gitconfig "$WEB/.git/config"

echo "===== TRACE / OPTIONS ====="
echo "API TRACE: $(curl -s -o /dev/null -w '%{http_code}' -X TRACE $API/api/health)"
echo "API OPTIONS /api/auth/login: $(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $API/api/auth/login)"
echo "WEB TRACE: $(curl -s -o /dev/null -w '%{http_code}' -X TRACE $WEB/)"

echo "===== CORS probes ====="
echo "--- API GET companies w/ Origin: http://evil.test ---"
curl -s -D - -o /dev/null $API/api/auth/companies -H 'Origin: http://evil.test' | tr -d '\r' | grep -iE '^(HTTP/|access-control)'
echo "--- API preflight OPTIONS login from evil ---"
curl -s -D - -o /dev/null -X OPTIONS $API/api/auth/login -H 'Origin: http://evil.test' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type,authorization' | tr -d '\r' | grep -iE '^(HTTP/|access-control)'
echo "--- API refresh w/ Origin null ---"
curl -s -D - -o /dev/null -X POST $API/api/auth/refresh -H 'Origin: null' | tr -d '\r' | grep -iE '^(HTTP/|access-control)'
echo "--- WEB CORS evil ---"
curl -s -D - -o /dev/null $WEB/api/auth/companies -H 'Origin: http://evil.test' | tr -d '\r' | grep -iE '^(HTTP/|access-control)'
echo "(no access-control-* line printed => CORS not enabled => browser blocks cross-origin reads)"
