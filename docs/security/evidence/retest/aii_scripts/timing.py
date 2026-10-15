"""RT AU-01: sign-in response time by account state, 35+ samples each, measured INSIDE the api container against
127.0.0.1:8000 (its own rate-limit bucket: the in-container loopback address; no header tricks). Requests are spaced
3.2 s apart so the 20/min per-address and 10/min per-login-id limits are never reached (a 429 is recorded, not retried).
Categories (interleaved round-robin so drift hits all equally):
  A existing account, wrong password  (throw-away BRUTE17; every 4th round one correct sign-in resets the counter)
  B non-existent login id             (a fresh random id each time)
  C deactivated account               (SECDIS)
  D sign-in switched off              (SECNOLOGIN)
  E locked account, wrong password    (SECLOCK)
  F existing account, right password  (BRUTE17, reference only)
Output: JSON with every sample + median/mean/p10/p90 per category. Passwords are not printed."""
import json
import secrets
import statistics
import sys
import time

import httpx

URL = "http://127.0.0.1:8000/api/auth/login"
ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 36
BRUTE17_PW = sys.argv[2]
WRONG = "Wrong#Pass2026x"
GAP = 3.2

samples = {k: [] for k in "ABCDEF"}
codes = {k: {} for k in "ABCDEF"}
client = httpx.Client(timeout=30)


def shot(cat, login_id, pw):
    t = time.perf_counter()
    r = client.post(URL, json={"login_id": login_id, "password": pw})
    ms = (time.perf_counter() - t) * 1000
    codes[cat][r.status_code] = codes[cat].get(r.status_code, 0) + 1
    if r.status_code != 429:
        samples[cat].append(round(ms, 2))
    time.sleep(GAP)


# warm-up (not recorded)
client.post(URL, json={"login_id": "warmup-" + secrets.token_hex(3), "password": WRONG})
time.sleep(GAP)
for i in range(ROUNDS):
    shot("A", "BRUTE17", WRONG)
    shot("B", "ghost-" + secrets.token_hex(4), WRONG)
    shot("C", "SECDIS", WRONG)
    shot("D", "SECNOLOGIN", WRONG)
    shot("E", "SECLOCK", WRONG)
    if i % 4 == 3:
        shot("F", "BRUTE17", BRUTE17_PW)
shot("F", "BRUTE17", BRUTE17_PW)


def stats(v):
    if not v:
        return {}
    s = sorted(v)
    q = lambda p: s[min(len(s) - 1, int(p * len(s)))]
    return {"n": len(v), "median": round(statistics.median(v), 2), "mean": round(statistics.mean(v), 2),
            "p10": q(0.1), "p90": q(0.9), "min": s[0], "max": s[-1]}


labels = {"A": "existing, wrong password", "B": "non-existent", "C": "deactivated (SECDIS)",
          "D": "sign-in off (SECNOLOGIN)", "E": "locked (SECLOCK), wrong pw", "F": "existing, right password"}
out = {"summary": {labels[k]: {**stats(samples[k]), "codes": codes[k]} for k in samples}, "samples": samples}
print(json.dumps(out, indent=1))
