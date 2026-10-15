#!/usr/bin/env bash
API=http://127.0.0.1:8200
PW='Sec#Test2026ok'
tok(){ sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }
SECHO=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECHO\",\"password\":\"$PW\"}" | tok)

echo "=== prep: clear must_change on BRUTE04 via change-password ==="
MT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"BRUTE04","password":"2a1RQBojIAT3"}' | tok)
echo "change-pw -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/change-password -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"old_password":"2a1RQBojIAT3","new_password":"NewBrute#2026x"}')"
AT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"BRUTE04","password":"NewBrute#2026x"}' | tok)
echo "working access token for BRUTE04: /capabilities -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $AT")"
echo "role in capabilities: $(curl -s $API/api/auth/capabilities -H "Authorization: Bearer $AT" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')"

echo "=== toggle login_enabled=false via API, reuse OLD access token ==="
echo "PUT login_enabled=false -> $(curl -s -o /dev/null -w '%{http_code}' -X PUT $API/api/asset-users/35 -H "Authorization: Bearer $SECHO" -H 'Content-Type: application/json' -d '{"login_enabled":false}')"
echo "OLD access token after login disabled -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $AT")  (200 => access token NOT revoked by login_enabled=false)"
echo "NEW login now -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"BRUTE04","password":"NewBrute#2026x"}')  (401 => new login blocked)"
echo "refresh when login disabled: login first to get cookie is impossible now; skip"

echo "=== role downgrade re-read from DB (OPERATOR->VIEWER) ==="
echo "PUT role=VIEWER -> $(curl -s -o /dev/null -w '%{http_code}' -X PUT $API/api/asset-users/35 -H "Authorization: Bearer $SECHO" -H 'Content-Type: application/json' -d '{"role":"VIEWER","login_enabled":true}')"
AT2=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"BRUTE04","password":"NewBrute#2026x"}' | tok)
echo "token role claim still from login; capabilities role -> $(curl -s $API/api/auth/capabilities -H "Authorization: Bearer $AT2" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')  (VIEWER => DB role re-read, token claim not trusted)"
