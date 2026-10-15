"""RT AU-03: sign-in / refresh / change-password limits, run inside the api container (loopback bucket, so the
host address shared with the other retest agent is not used up). Bounded: <= ~110 requests in total."""
import json
import time

import httpx

B = "http://127.0.0.1:8000/api/auth"
c = httpx.Client(timeout=30)
out = {}


def login(lid, headers=None):
    return c.post(f"{B}/login", json={"login_id": lid, "password": "Wrong#Pass2026x"}, headers=headers or {})


def summary(rs):
    codes = [r.status_code for r in rs]
    first = next((i for i, x in enumerate(codes) if x == 429), None)
    r429 = rs[first] if first is not None else None
    return {"codes": codes, "first_429_at": None if first is None else first + 1,
            "retry_after": r429.headers.get("retry-after") if r429 is not None else None,
            "body": r429.json() if r429 is not None else None}


time.sleep(65)                                   # let the window from earlier tests expire
out["login_per_address"] = summary([login(f"rl-ip-{i}") for i in range(21)])
spoof = login("rl-ip-spoof", {"X-Forwarded-For": "203.0.113.9"})
out["login_xff_spoof_after_limit"] = spoof.status_code
spoof2 = login("rl-ip-spoof2", {"X-Forwarded-For": "203.0.113.10, 198.51.100.7", "X-Real-IP": "198.51.100.8"})
out["login_xff_chain_after_limit"] = spoof2.status_code
time.sleep(62)
out["login_per_login_id"] = summary([login("rl-same-id") for _ in range(11)])
out["login_per_login_id_case_variant"] = login("RL-SAME-ID ").status_code
out["refresh_per_address"] = summary([c.post(f"{B}/refresh") for _ in range(61)])
out["change_password_unauth"] = summary([c.post(f"{B}/change-password", json={"old_password": "x" * 8, "new_password": "y" * 8}) for _ in range(11)])
time.sleep(62)
out["login_after_window"] = login("rl-after-window").status_code
print(json.dumps(out, indent=1))
