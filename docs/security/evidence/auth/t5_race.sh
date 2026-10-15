#!/usr/bin/env bash
API=http://127.0.0.1:8200
D="C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/auth"
# 20 PARALLEL wrong-password logins against BRUTE02 (id 33), started as simultaneously as possible.
one(){ curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"BRUTE02\",\"password\":\"race$1\"}"; }
export -f one; export API
seq 1 20 | xargs -P 20 -I{} bash -c 'one {}' > "$D/race_codes.txt" 2>&1
echo "status code distribution (20 parallel):"
sort "$D/race_codes.txt" | uniq -c
echo "401 => guess was processed (accepted as an attempt); if >5 => lockout bypassed by concurrency"
