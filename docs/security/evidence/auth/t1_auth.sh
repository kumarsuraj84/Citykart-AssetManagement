#!/usr/bin/env bash
# Auth state + token tests. Output: pipe-delimited id|desc|http|snippet
API=http://127.0.0.1:8200
PW='Sec#Test2026ok'
jqget(){ sed -n 's/.*"'"$1"'":"\([^"]*\)".*/\1/p'; }
login(){ curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"$1\",\"password\":\"$2\"}"; }
code(){ curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"$1\",\"password\":\"$2\"}"; }

echo "=== login state matrix ==="
for u in SECHO SECOPIT SECVIEW SECSELF; do echo "VALID $u -> $(code $u "$PW")"; done
echo "WRONGPW SECOPIT -> $(code SECOPIT wrongpass123)"
echo "NOSUCH ghostuser -> $(code ghostuser "$PW")"
echo "DISABLED SECDIS -> $(code SECDIS "$PW")"
echo "NOLOGIN SECNOLOGIN -> $(code SECNOLOGIN "$PW")"
echo "LOCKED SECLOCK (correctpw) -> $(code SECLOCK "$PW")"
echo "LOCKED SECLOCK (wrongpw)   -> $(code SECLOCK wrongXX)"
echo "MUSTCHANGE SECMUST login   -> $(code SECMUST "$PW")"
echo "EMAIL login SECOPIT@sec.test -> $(code SECOPIT@sec.test "$PW")"
echo "CASE secopit (lower code)  -> $(code secopit "$PW")"
echo "CASE SECOPIT@SEC.TEST upper -> $(code SECOPIT@SEC.TEST "$PW")"
echo "SQLi login id              -> $(code "SECOPIT' OR '1'='1" "$PW")"
echo "SQLi 2                     -> $(code "' OR 1=1 --" "$PW")"

echo "=== bodies for enumeration (exact detail text) ==="
echo "NOSUCH body:    $(login ghostuser "$PW")"
echo "WRONGPW body:   $(login SECOP2IT wrongpass123)"
echo "DISABLED body:  $(login SECDIS "$PW")"
echo "LOCKED body:    $(login SECLOCK "$PW")"

echo "=== MUSTCHANGE: can SECMUST use other routes? ==="
MT=$(login SECMUST "$PW" | jqget access_token)
echo "SECMUST capabilities -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $MT")"
echo "SECMUST assets -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/assets -H "Authorization: Bearer $MT")"

echo "=== access token tests ==="
AT=$(login SECOPIT "$PW" | jqget access_token)
echo "valid token /capabilities -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $AT")"
echo "no token -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities)"
echo "garbage token -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H 'Authorization: Bearer not.a.jwt')"
# tamper: flip last char of signature
TAMP="${AT%?}X"
echo "tampered sig -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $TAMP")"
echo "tampered sig body: $(curl -s $API/api/auth/capabilities -H "Authorization: Bearer $TAMP")"

echo "=== refresh token used as access token ==="
RT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECOPIT\",\"password\":\"$PW\"}" -D - -o /dev/null | grep -i '^set-cookie: refresh_token=' | sed 's/.*refresh_token=//; s/;.*//')
echo "refresh-as-access -> $(curl -s -o /dev/null -w '%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $RT")"

echo "=== access token used as refresh (cookie) ==="
echo "access-as-refresh -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh -H "Cookie: refresh_token=$AT")"
echo "refresh no cookie -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh)"
echo "refresh valid -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh -H "Cookie: refresh_token=$RT")"
echo "done"
