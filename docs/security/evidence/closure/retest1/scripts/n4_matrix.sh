#!/bin/sh
# CL1 N4 environment fail-closed. Runs INSIDE a throw-away network-less container of ckam-sec-api, no database.
# Starts uvicorn with ENVIRONMENT_NAME x JWT_SECRET combos; reports exit, health, docs/redoc/openapi and whether
# startup was refused. Only FAKE / committed-placeholder secrets are used; none are echoed by the app on refusal.
cd /app
PORT=8301
GOOD='CL1GOODaXk93Qm7Zp2Vn8Rt4Lw6Yc1Bd5Fg0Hj'   # fake, 40 chars, >=8 distinct
S31='abcdefghijklmnopqrstuvwxyz01234'            # 31 chars (too short by one)
S32x4='abcdabcdabcdabcdabcdabcdabcdabcd'         # 32 chars but only 4 distinct
SPACES40='                                        '
A40='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

probe() {  # $1 port -> prints "health docs redoc openapi"
  python - "$1" <<'PY'
import http.client,sys
p=int(sys.argv[1])
def g(path):
    try:
        c=http.client.HTTPConnection('127.0.0.1',p,timeout=3);c.request('GET',path);r=c.getresponse();b=r.read()
        if path=='/docs': return f"{r.status}{'+swagger' if b'swagger' in b.lower() else ''}"
        if path=='/openapi.json': return f"{r.status}{'+openapi' if b'\"openapi\"' in b else ''}"
        return str(r.status)
    except Exception: return 'NOCONN'
print(g('/api/health'), g('/docs'), g('/redoc'), g('/openapi.json'))
PY
}

run() {  # $1 label ; rest: env assignments
  label="$1"; shift
  port=$PORT; PORT=$((PORT+1))
  env "$@" LOG_DIR=/tmp/logs ENV_FILE=/nonexistent timeout 9 uvicorn app.main:app --host 127.0.0.1 --port "$port" > /tmp/st_$port.log 2>&1 &
  pid=$!
  sleep 6
  probed=$(probe "$port")
  refused=$(grep -c 'Refusing to start' /tmp/st_$port.log)
  startfail=$(grep -c 'Application startup failed' /tmp/st_$port.log)
  started=$(grep -c 'Application startup complete' /tmp/st_$port.log)
  wait "$pid" 2>/dev/null; rc=$?
  echo "$label | exit=$rc | health/docs/redoc/openapi=[$probed] | refused=$refused startfail=$startfail started=$started"
}

echo "===== A. production-treated ENV names + committed placeholder secret (expect REFUSE) ====="
run "env=UNSET + placeholder"      JWT_SECRET=dev_secret_change_me
run "env=blank + placeholder"      ENVIRONMENT_NAME= JWT_SECRET=dev_secret_change_me
run "env=prd + placeholder"        ENVIRONMENT_NAME=prd JWT_SECRET=dev_secret_change_me
run "env=live + placeholder"       ENVIRONMENT_NAME=live JWT_SECRET=dev_secret_change_me
run "env=prod-1 + placeholder"     ENVIRONMENT_NAME=prod-1 JWT_SECRET=dev_secret_change_me
run "env=Production + placeholder" ENVIRONMENT_NAME=Production JWT_SECRET=dev_secret_change_me
run "env=' PROD ' + placeholder"   "ENVIRONMENT_NAME= PROD " JWT_SECRET=dev_secret_change_me
run "env=staging + placeholder"    ENVIRONMENT_NAME=staging JWT_SECRET=dev_secret_change_me
run "env=banana(arb) + placeholder" ENVIRONMENT_NAME=banana JWT_SECRET=dev_secret_change_me

echo "===== B. env=production + each weak secret (expect REFUSE) ====="
run "prod + change_me_too"         ENVIRONMENT_NAME=production JWT_SECRET=change_me_too
run "prod + short('short')"        ENVIRONMENT_NAME=production JWT_SECRET=short
run "prod + 40 spaces"             ENVIRONMENT_NAME=production "JWT_SECRET=$SPACES40"
run "prod + 40xa"                  ENVIRONMENT_NAME=production JWT_SECRET=$A40
run "prod + 31 chars"              ENVIRONMENT_NAME=production JWT_SECRET=$S31
run "prod + 32 chars/4 distinct"   ENVIRONMENT_NAME=production JWT_SECRET=$S32x4

echo "===== C. production-treated + GOOD secret (expect START, docs OFF) ====="
run "prod + good"                  ENVIRONMENT_NAME=production JWT_SECRET=$GOOD
run "prd + good"                   ENVIRONMENT_NAME=prd JWT_SECRET=$GOOD
run "live + good"                  ENVIRONMENT_NAME=live JWT_SECRET=$GOOD

echo "===== D. dev/non-production names + placeholder (expect START, docs ON) ====="
for e in development dev test testing uat security-test local ci; do
  run "env=$e + placeholder"       ENVIRONMENT_NAME=$e JWT_SECRET=dev_secret_change_me
done

echo "===== refusal message wording (prod+placeholder, prod+40xa) ====="
grep -h -m1 'Refusing to start' /tmp/st_8301.log /tmp/st_8313.log 2>/dev/null | cut -c1-260
