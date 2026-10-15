#!/usr/bin/env bash
API=http://127.0.0.1:8200
WEB=http://localhost:3411
echo "=== /.env body (first 120 chars) -- is it SPA index.html? ==="
curl -s $WEB/.env | head -c 120; echo; echo
echo "=== /docs via WEB 3411 (should be SPA, not Swagger) first 120 ==="
curl -s $WEB/docs | head -c 120; echo; echo
echo "=== source maps: find a JS asset then request its .map ==="
JS=$(curl -s $WEB/ | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
echo "asset: $JS"
echo ".js status: $(curl -s -o /dev/null -w '%{http_code}' $WEB$JS)"
echo ".js.map status: $(curl -s -o /dev/null -w '%{http_code}' $WEB$JS.map)"
echo "any index/.map referenced in JS? $(curl -s $WEB$JS | grep -oE 'sourceMappingURL=[^ ]+' | head -1)"
echo
echo "=== X-Request-ID validation: send CRLF + 300-char id ==="
BADID=$'abc\r\nSet-Cookie: x=1'"$(printf 'A%.0s' {1..300})"
echo "echoed id for CRLF/overlong: "; curl -s -D - -o /dev/null $API/api/health -H "X-Request-ID: $BADID" | tr -d '\r' | grep -i x-request-id
echo "echoed id for CLEAN id abc-123_OK:"; curl -s -D - -o /dev/null $API/api/health -H "X-Request-ID: abc-123_OK" | tr -d '\r' | grep -i x-request-id
echo
echo "=== 413: nginx client_max_body_size (send ~12MB to /api/auth/login via WEB) ==="
head -c 12000000 /dev/zero | tr '\0' 'a' > /tmp/big.bin
echo "WEB 12MB -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $WEB/api/auth/login -H 'Content-Type: application/json' --data-binary @/tmp/big.bin)"
echo "413 body has request_id? "; curl -s -X POST $WEB/api/auth/login -H 'Content-Type: application/json' --data-binary @/tmp/big.bin | head -c 200; echo
rm -f /tmp/big.bin
