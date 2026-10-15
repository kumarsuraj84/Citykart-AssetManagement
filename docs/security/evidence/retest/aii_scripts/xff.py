"""RT AU-03: can X-Forwarded-For buy fresh sign-in attempts? Same test from two peers inside the api container:
  (1) peer 172.25.0.3 (the container's own network address: like a LAN client / nginx -- not a trusted proxy)
  (2) peer 127.0.0.1 (loopback: uvicorn's default --forwarded-allow-ips=127.0.0.1 rewrites the client from XFF)
Bounded: 22 requests per peer."""
import json
import sys
import time

import httpx

out = {}
for label, host in (("peer_172.25.0.3", sys.argv[1]), ("peer_127.0.0.1", "127.0.0.1")):
    c = httpx.Client(timeout=30)
    url = f"http://{host}:8000/api/auth/login"
    codes = [c.post(url, json={"login_id": f"xff-{label}-{i}", "password": "Wrong#Pass2026x"}).status_code for i in range(20)]
    plain = c.post(url, json={"login_id": f"xff-{label}-plain", "password": "Wrong#Pass2026x"}).status_code
    spoof = c.post(url, json={"login_id": f"xff-{label}-spoof", "password": "Wrong#Pass2026x"},
                   headers={"X-Forwarded-For": "203.0.113.77"}).status_code
    out[label] = {"first20": sorted(set(codes)), "21st_plain": plain, "22nd_with_XFF": spoof}
    time.sleep(62)
print(json.dumps(out))
