#!/usr/bin/env bash
API=http://127.0.0.1:8200
PW='Sec#Test2026ok'
getcookie(){ grep -i refresh_token "$1" | awk '{print $NF}'; }
D="C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/auth"

echo "=== Set-Cookie flags on login ==="
curl -s -D - -o /dev/null -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECVIEW\",\"password\":\"$PW\"}" | tr -d '\r' | grep -i '^set-cookie'

echo "=== rotation + OLD refresh reuse ==="
curl -s -o /dev/null -c "$D/c1.txt" -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECVIEW\",\"password\":\"$PW\"}"
RT1=$(getcookie "$D/c1.txt")
echo "RT1 captured (len ${#RT1})"
# use RT1 -> get RT2
curl -s -o /dev/null -b "$D/c1.txt" -c "$D/c2.txt" -X POST $API/api/auth/refresh
RT2=$(getcookie "$D/c2.txt")
echo "after refresh, RT2 len ${#RT2}; rotated? $([ "$RT1" != "$RT2" ] && echo YES || echo NO)"
echo "reuse OLD RT1 again AFTER it was used -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh -H "Cookie: refresh_token=$RT1")  (200 => old refresh still valid = no reuse detection)"
echo "use NEW RT2 -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh -H "Cookie: refresh_token=$RT2")"

echo "=== refresh AFTER logout (token not invalidated server-side?) ==="
curl -s -o /dev/null -c "$D/c3.txt" -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"SECVIEW\",\"password\":\"$PW\"}"
RT3=$(getcookie "$D/c3.txt")
echo "logout status -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/logout -H "Cookie: refresh_token=$RT3")"
echo "refresh with pre-logout RT3 -> $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/refresh -H "Cookie: refresh_token=$RT3")  (200 => logout did NOT invalidate the refresh token)"
echo "=== logout Set-Cookie flags ==="
curl -s -D - -o /dev/null -X POST $API/api/auth/logout -H "Cookie: refresh_token=$RT3" | tr -d '\r' | grep -i '^set-cookie'
