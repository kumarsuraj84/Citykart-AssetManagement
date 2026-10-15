#!/bin/sh
# RT IF-04/AU-09 + AU-11: start uvicorn with different ENVIRONMENT_NAME / JWT_SECRET combinations (throw-away,
# network-less container, no database). Secrets: only FAKE values or the committed public placeholders.
cd /app
run() { # $1 label, $2 port, rest: env assignments
  label="$1"; port="$2"; shift 2
  env "$@" LOG_DIR=/tmp/logs timeout 12 uvicorn app.main:app --host 127.0.0.1 --port "$port" > /tmp/st_$port.log 2>&1 &
  sleep 7
  code=$(python -c "import http.client,sys
try:
    c=http.client.HTTPConnection('127.0.0.1',$port,timeout=3);c.request('GET','/api/health');print(c.getresponse().status)
except Exception as e: print('NOCONN')")
  docs=$(python -c "import http.client
try:
    c=http.client.HTTPConnection('127.0.0.1',$port,timeout=3);c.request('GET','/docs');r=c.getresponse();b=r.read();print(r.status, 'swagger' if b'swagger' in b.lower() else '-')
except Exception as e: print('NOCONN')")
  oj=$(python -c "import http.client
try:
    c=http.client.HTTPConnection('127.0.0.1',$port,timeout=3);c.request('GET','/openapi.json');r=c.getresponse();b=r.read();print(r.status, 'openapi' if b'\"openapi\"' in b else '-')
except Exception as e: print('NOCONN')")
  redoc=$(python -c "import http.client
try:
    c=http.client.HTTPConnection('127.0.0.1',$port,timeout=3);c.request('GET','/redoc');r=c.getresponse();b=r.read();print(r.status)
except Exception as e: print('NOCONN')")
  refused=$(grep -c 'Refusing to start' /tmp/st_$port.log)
  started=$(grep -c 'Application startup complete' /tmp/st_$port.log)
  warn=$(grep -c 'SECURITY WARNING' /tmp/st_$port.log)
  echo "$label | health=$code | docs=$docs | openapi=$oj | redoc=$redoc | refused_line=$refused started_line=$started warn_line=$warn"
  wait
}
run "A prod + committed default dev secret" 8101 ENVIRONMENT_NAME=production JWT_SECRET=dev_secret_change_me
run "B prod + JWT_SECRET unset (falls back to default)" 8102 ENVIRONMENT_NAME=production
run "C prod + .env.example placeholder change_me_too" 8103 ENVIRONMENT_NAME=production JWT_SECRET=change_me_too
run "D prod + 31-char random secret" 8104 ENVIRONMENT_NAME=production JWT_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz01234
run "E PROD (upper case) + default" 8105 ENVIRONMENT_NAME=PROD JWT_SECRET=dev_secret_change_me
run "F ' Production ' (spaces) + default" 8106 "ENVIRONMENT_NAME= Production " JWT_SECRET=dev_secret_change_me
run "G prod + empty JWT_SECRET" 8107 ENVIRONMENT_NAME=production JWT_SECRET=
run "H prod + 48-char FAKE secret (expect start, docs off)" 8108 ENVIRONMENT_NAME=production JWT_SECRET=RT-FAKE-CANARY-0123456789abcdef0123456789abcd
run "I prod + 32-char exactly (boundary, expect start)" 8109 ENVIRONMENT_NAME=production JWT_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz012345
run "J ENVIRONMENT_NAME unset (default development) + default secret" 8110 JWT_SECRET=dev_secret_change_me
run "K ENVIRONMENT_NAME=prd (typo/alias) + default secret" 8111 ENVIRONMENT_NAME=prd JWT_SECRET=dev_secret_change_me
run "L ENVIRONMENT_NAME=live + default secret" 8112 ENVIRONMENT_NAME=live JWT_SECRET=dev_secret_change_me
run "M prod + 40 spaces secret" 8113 ENVIRONMENT_NAME=production "JWT_SECRET=                                        "
echo "--- refusal message (A) ---"
grep -m1 'Refusing to start' /tmp/st_8101.log | cut -c1-220
