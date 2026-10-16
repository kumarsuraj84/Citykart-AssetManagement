#!/bin/sh
# CL3 IF-04 single-port production retest, inside a throw-away NETWORK-LESS container of the FINAL api image.
# FAKE canary secrets only. uvicorn runs in single-port production mode (FRONTEND_DIST_DIR set, ENVIRONMENT_NAME
# =production, a good 40-char fake secret so startup is allowed). Canary files named exactly like app routes are
# placed INSIDE <dist>/assets to prove the 'route-looking name' fallback never reads them off disk.
set -e
cd /app
ROOT=/tmp/root
DIST=$ROOT/releases/abc/frontend-dist
mkdir -p "$DIST/assets" "$ROOT/shared" "$DIST/assets_evil"
# legit hashed assets (expect 200, real file)
printf 'ok-legit-js' > "$DIST/assets/a.js"
printf 'ok-hashed-js' > "$DIST/assets/index-A1b2C3d4.js"
printf 'ok-hashed-css' > "$DIST/assets/app-Z9y8X7w6.css"
# the SPA shell (unique marker so the probe can tell shell from a file)
printf '<html>shell</html>' > "$DIST/index.html"
# canary files named exactly like app routes -- if any of these is ever served, that is a FINDING
printf 'CANARY-ROUTE-NEW' > "$DIST/assets/new"
printf 'CANARY-ROUTE-123' > "$DIST/assets/123"
printf 'CANARY-ROUTE-SETTINGS' > "$DIST/assets/settings"
printf 'CANARY-DEVICE-CON' > "$DIST/assets/CON" 2>/dev/null || true
# secrets OUTSIDE the dist dir (traversal targets)
printf 'OUTSIDE-DIST-CANARY' > /tmp/secret_outside.txt
printf 'JWT_SECRET=FAKE-CANARY-NOT-REAL\nDATABASE_URL=postgresql+asyncpg://u:FAKE@x/y\n' > "$ROOT/shared/.env"
printf 'FAKE-NAS-CANARY' > "$ROOT/shared/nas.pw"
printf 'SIBLING-CANARY' > "$DIST/assets_evil/canary.txt"
ln -sf /tmp/secret_outside.txt "$DIST/assets/link_out.txt"

FRONTEND_DIST_DIR="$DIST" ENVIRONMENT_NAME=production JWT_SECRET=CL3GOODaXk93Qm7Zp2Vn8Rt4Lw6Yc1Bd5Fg0Hj7Kp \
  LOG_DIR=/tmp/logs timeout 45 uvicorn app.main:app --host 127.0.0.1 --port 8400 > /tmp/if04_uvicorn.log 2>&1 &
UPID=$!
sleep 7
echo "=== probe output ==="
python /probe/if04_probe.py
echo "=== startup/5xx check in uvicorn log ==="
echo "500 responses: $(grep -c ' 500 ' /tmp/if04_uvicorn.log || true)"
echo "Tracebacks:    $(grep -c 'Traceback' /tmp/if04_uvicorn.log || true)"
echo "Refused start: $(grep -c 'Refusing to start' /tmp/if04_uvicorn.log || true)"
echo "--- last 8 uvicorn log lines ---"
tail -n 8 /tmp/if04_uvicorn.log || true
kill $UPID 2>/dev/null || true
wait $UPID 2>/dev/null || true
