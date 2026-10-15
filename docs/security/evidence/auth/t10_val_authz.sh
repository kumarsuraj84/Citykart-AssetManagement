#!/usr/bin/env bash
API=http://127.0.0.1:8200
PW='Sec#Test2026ok'
tok(){ sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }
SECHO=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECHO\",\"password\":\"$PW\"}" | tok)
OPIT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECOPIT\",\"password\":\"$PW\"}" | tok)
FAIT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECFAIT\",\"password\":\"$PW\"}" | tok)
SELF=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECSELF\",\"password\":\"$PW\"}" | tok)
c(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "=== LOGIN input validation (expect controlled 4xx, never 500) ==="
echo "missing password     -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"x"}')"
echo "wrong type (int pw)  -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"x","password":12345}')"
echo "unknown extra field  -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"SECOPIT","password":"'"$PW"'","evil":"x"}')"
echo "empty login_id       -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"","password":"x"}')"
echo "array where str      -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":["a"],"password":"x"}')"
echo "NUL char in login_id -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"login_id":"ab\u0000cd","password":"x"}')"
echo "10k-char login_id    -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"$(printf 'A%.0s' {1..10000})\",\"password\":\"x\"}")"
echo "malformed JSON       -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{bad json')"
echo "long password >128   -> $(c -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECOPIT\",\"password\":\"$(printf 'B%.0s' {1..5000})\"}")"

echo "=== change-password policy (as a throwaway token won't work for SEC*, use OPIT only to probe 400/422) ==="
echo "short new pw (len5)  -> $(c -X POST $API/api/auth/change-password -H "Authorization: Bearer $OPIT" -H 'Content-Type: application/json' -d '{"old_password":"whatever","new_password":"abcde"}')"
echo "new==old (both wrong)-> $(c -X POST $API/api/auth/change-password -H "Authorization: Bearer $OPIT" -H 'Content-Type: application/json' -d '{"old_password":"same12345","new_password":"same12345"}')"
echo "weak common 'password1' (len9) wrong old -> $(c -X POST $API/api/auth/change-password -H "Authorization: Bearer $OPIT" -H 'Content-Type: application/json' -d '{"old_password":"wrongold1","new_password":"password1"}')  (400 old wrong => cannot reach policy; note: no complexity/common-pw rule exists)"

echo "=== admin endpoint authz ==="
echo "SECHO  /api/admin/logs/audit        -> $(c $API/api/admin/logs/audit -H "Authorization: Bearer $SECHO")"
echo "SECFAIT(ADMIN,not owner) logs/audit -> $(c $API/api/admin/logs/audit -H "Authorization: Bearer $FAIT")"
echo "SECOPIT(OPERATOR) logs/audit        -> $(c $API/api/admin/logs/audit -H "Authorization: Bearer $OPIT")"
echo "SECHO  diagnostics/bundle           -> $(c $API/api/admin/diagnostics/bundle -H "Authorization: Bearer $SECHO")"
echo "SECFAIT diagnostics/bundle          -> $(c $API/api/admin/diagnostics/bundle -H "Authorization: Bearer $FAIT")"
echo "SECOPIT issue-passwords             -> $(c -X POST $API/api/asset-users/issue-passwords -H "Authorization: Bearer $OPIT" -H 'Content-Type: application/json' -d '{"asset_user_ids":[20]}')"
echo "SECFAIT issue-passwords (ADMIN ok?) -> $(c -X POST $API/api/asset-users/issue-passwords -H "Authorization: Bearer $FAIT" -H 'Content-Type: application/json' -d '{"asset_user_ids":[99999]}')"

echo "=== client report submit + stored XSS payload + who can read ==="
REF=$(curl -s -X POST $API/api/client-reports -H "Authorization: Bearer $SELF" -H 'Content-Type: application/json' -d '{"message":"<script>alert(document.cookie)</script>","route":"/x","kind":"USER_REPORT"}')
echo "self submit resp: $(echo "$REF" | cut -c1-160)"
echo "SELF_SERVICE list client-reports -> $(c $API/api/admin/logs/client-reports -H "Authorization: Bearer $SELF")  (403 expected)"
echo "client-reports endpoints present:"; grep -oE '"/api/client-reports[^"]*"' /dev/null 2>/dev/null
