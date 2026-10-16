#!/bin/bash
# CL2-IF item 3 extra: a 413 produced by the API itself (100 KB sign-in body: under nginx's 11m, over the API's
# 64 KB auth limit) travelling back through nginx -- every security header exactly once (N5), request id present.
B="${1:-http://localhost:3411}"
T=$(mktemp -d)
head -c 102400 /dev/zero | tr '\0' 'a' | sed 's/^/{"login_id":"x","password":"/; s/$/"}/' > "$T/b.json"
curl -s -D "$T/h" -o "$T/o" -X POST -H "Content-Type: application/json" --data-binary "@$T/b.json" "$B/api/auth/login"
head -1 "$T/h"
for k in X-Content-Type-Options X-Frame-Options Referrer-Policy Content-Security-Policy Permissions-Policy Cache-Control X-Request-ID Server; do
  echo "  $k x$(grep -ic "^$k:" "$T/h"): $(grep -i "^$k:" "$T/h" | tr -d '\r' | cut -d' ' -f2- | paste -sd'|' - | cut -c1-80)"
done
echo "  body: $(head -c 140 "$T/o")"
rm -rf "$T"
