#!/bin/bash
# CL1 N1 request-size limits -- host-side fixed-size battery against the LIVE stack 127.0.0.1:8200.
# Checks 413 + envelope (detail/errors/request_id) + X-Request-ID + security headers, and that legit sizes pass.
API=http://127.0.0.1:8200
BASE="C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl1"
TOK=$(cat "$BASE/secho.tok")
OUT="$BASE/n1"; mkdir -p "$OUT"
LOG="$OUT/n1_host_results.txt"; : > "$LOG"

mkfield() { head -c "$1" /dev/zero | tr '\0' a; }

run() {
  label="$1"; shift
  code=$(curl -s -D "$OUT/h.tmp" -o "$OUT/b.tmp" -w "%{http_code}" "$@" 2>>"$OUT/curl_err.txt")
  rid=$(grep -i '^x-request-id:' "$OUT/h.tmp" | tr -d '\r' | awk '{print $2}')
  bodyrid=$(grep -o '"request_id":"[^"]*"' "$OUT/b.tmp" | head -1)
  csp=$(grep -ic '^content-security-policy:' "$OUT/h.tmp")
  nosniff=$(grep -ic '^x-content-type-options: nosniff' "$OUT/h.tmp")
  xfo=$(grep -ic '^x-frame-options:' "$OUT/h.tmp")
  hasdetail=$(grep -oc '"detail"' "$OUT/b.tmp")
  haserrors=$(grep -oc '"errors"' "$OUT/b.tmp")
  body=$(head -c 160 "$OUT/b.tmp" | tr '\n' ' ')
  printf '[%s] http=%s xrid=%s bodyrid=%s csp=%s nosniff=%s xfo=%s detail=%s errors=%s body=%s\n' \
    "$label" "$code" "${rid:0:8}" "$bodyrid" "$csp" "$nosniff" "$xfo" "$hasdetail" "$haserrors" "$body" | tee -a "$LOG"
}

# ---- AUTH endpoint (limit 64 KB) ----
printf '{"login_id":"x","password":"%s"}' "$(mkfield 71680)" > "$OUT/auth70k.json"
run "auth 70KB (over 64KB)" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' --data-binary @"$OUT/auth70k.json"

printf '{"login_id":"x","password":"%s"}' "$(mkfield 60000)" > "$OUT/auth60k.json"
run "auth ~60KB (under 64KB, expect 401 not 413)" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' --data-binary @"$OUT/auth60k.json"

printf '{"login_id":"x","password":"%s"}' "$(mkfield 1048576)" > "$OUT/auth1m.json"
run "auth 1MB" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' --data-binary @"$OUT/auth1m.json"

printf '{"login_id":"x","password":"%s"}' "$(mkfield 10485760)" > "$OUT/auth10m.json"
run "auth 10MB" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' --data-binary @"$OUT/auth10m.json"

# ---- normal JSON POST (limit 5 MB) -- authenticated brand create ----
printf '{"name":"CL1BIG%s"}' "$(mkfield 4800000)" > "$OUT/json_under5m.json"
run "json ~4.8MB brand (under 5MB)" -X POST "$API/api/masters/brands" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' --data-binary @"$OUT/json_under5m.json"

printf '{"name":"CL1BIG%s"}' "$(mkfield 5400000)" > "$OUT/json_over5m.json"
run "json ~5.4MB brand (over 5MB)" -X POST "$API/api/masters/brands" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' --data-binary @"$OUT/json_over5m.json"

# ---- multipart (limit 16 MB). under-size -> import PREVIEW (does not persist); over-size -> document endpoint ----
mkfield 15000000 > "$OUT/mp_under.bin"
run "multipart ~15MB to /api/imports/assets/preview (under 16MB, no persist)" -X POST "$API/api/imports/assets/preview" -H "Authorization: Bearer $TOK" -F "file=@$OUT/mp_under.bin;filename=cl1under.xlsx;type=application/octet-stream"

mkfield 17000000 > "$OUT/mp_over.bin"
run "multipart ~17MB to /api/assets/1/documents (over 16MB)" -X POST "$API/api/assets/1/documents" -H "Authorization: Bearer $TOK" -F "file=@$OUT/mp_over.bin;filename=cl1over.pdf;type=application/pdf"

# ---- multipart to import endpoint (limit 16 MB), as SECHO ----
mkfield 17000000 > "$OUT/imp_over.bin"
run "multipart ~17MB to /api/imports/assets/preview (over 16MB)" -X POST "$API/api/imports/assets/preview" -H "Authorization: Bearer $TOK" -F "file=@$OUT/imp_over.bin;filename=cl1imp.xlsx;type=application/octet-stream"

# ---- legit sizes still succeed ----
run "legit small sign-in (real creds)" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"login_id":"SECHO","password":"Sec#Test2026ok"}'

echo "=== done ===" | tee -a "$LOG"
rm -f "$OUT"/auth*.json "$OUT"/json_*.json "$OUT"/mp_*.bin "$OUT"/imp_*.bin "$OUT/h.tmp" "$OUT/b.tmp"
