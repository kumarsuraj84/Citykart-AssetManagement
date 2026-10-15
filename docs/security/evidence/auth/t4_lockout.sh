#!/usr/bin/env bash
API=http://127.0.0.1:8200
code(){ curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"login_id\":\"$1\",\"password\":\"$2\"}"; }
# correct temp passwords
P01=E7jV9Jr084un; P02=e4RGKb99JktE; P03=U2qTwwitSWe5; P04=2a1RQBojIAT3

echo "=== THRESHOLD (BRUTE01), 7 wrong then correct ==="
for i in $(seq 1 7); do echo "wrong attempt $i -> $(code BRUTE01 WRONGpw$i)"; done
echo "correct after lock -> $(code BRUTE01 $P01)"

echo "=== RESET ON SUCCESS (BRUTE04): 4 wrong, 1 correct, 4 wrong ==="
for i in $(seq 1 4); do echo "pre wrong $i -> $(code BRUTE04 bad$i)"; done
echo "correct -> $(code BRUTE04 $P04)"
for i in $(seq 1 4); do echo "post wrong $i -> $(code BRUTE04 bad$i)"; done
echo "still works? correct -> $(code BRUTE04 $P04)"

echo "=== XFF spoof against per-account lock (BRUTE03): does changing X-Forwarded-For help? ==="
for i in $(seq 1 6); do
  hc=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/auth/login -H 'Content-Type: application/json' \
       -H "X-Forwarded-For: 10.9.9.$i" -d "{\"login_id\":\"BRUTE03\",\"password\":\"nope$i\"}")
  echo "wrong w/ XFF 10.9.9.$i -> $hc"
done
echo "correct BRUTE03 -> $(code BRUTE03 $P03)  (423 => per-account lock, XFF ignored)"
