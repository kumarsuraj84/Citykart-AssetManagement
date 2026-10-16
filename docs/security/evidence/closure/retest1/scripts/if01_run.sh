#!/bin/sh
# CL1 IF-01 path-traversal retest on the PRODUCTION layout, inside a throw-away network-less container of
# ckam-sec-api. FAKE canary secrets only, placed OUTSIDE the dist dir. uvicorn runs with FRONTEND_DIST_DIR set
# (the single-port production mode) and a good fake secret so startup is allowed.
cd /app
ROOT=/tmp/root
DIST=$ROOT/releases/abc/frontend-dist
mkdir -p "$DIST/assets" "$ROOT/shared" "$DIST/assets_evil"
printf 'ok-legit-js' > "$DIST/assets/a.js"
printf 'ok-hashed' > "$DIST/assets/index-A1b2C3d4.js"
printf '<html>shell</html>' > "$DIST/index.html"
printf 'OUTSIDE-DIST-CANARY' > /tmp/secret_outside.txt
printf 'JWT_SECRET=FAKE-CANARY-NOT-REAL\nDATABASE_URL=postgresql+asyncpg://u:FAKE@x/y\n' > "$ROOT/shared/.env"
printf 'FAKE-NAS-CANARY' > "$ROOT/shared/nas.pw"
printf 'SIBLING-CANARY' > "$DIST/assets_evil/canary.txt"
ln -sf /tmp/secret_outside.txt "$DIST/assets/link_out.txt"

FRONTEND_DIST_DIR="$DIST" ENVIRONMENT_NAME=production JWT_SECRET=CL1GOODaXk93Qm7Zp2Vn8Rt4Lw6Yc1Bd5Fg0Hj \
  LOG_DIR=/tmp/logs timeout 40 uvicorn app.main:app --host 127.0.0.1 --port 8400 > /tmp/if01_uvicorn.log 2>&1 &
UPID=$!
sleep 6
python /tmp/if01_probe.py
RC=$?
echo "--- 5xx in uvicorn log? ---"
grep -c ' 500 ' /tmp/if01_uvicorn.log
grep -c 'Traceback' /tmp/if01_uvicorn.log
kill $UPID 2>/dev/null
wait $UPID 2>/dev/null
exit $RC
