#!/usr/bin/env bash
API=http://127.0.0.1:8200
C="C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/auth/crafted.txt"
test_tok(){
  local label="$1" tok="$2"
  local out=$(curl -s -w '|%{http_code}' $API/api/auth/capabilities -H "Authorization: Bearer $tok")
  local hc="${out##*|}"; local body="${out%|*}"
  local role=$(echo "$body" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
  echo "$label -> HTTP $hc role=${role:-none}"
}
while read -r label tok; do
  [ -z "$tok" ] && continue
  case "$label" in ORIG_*) continue;; esac
  test_tok "$label" "$tok"
done < "$C"
