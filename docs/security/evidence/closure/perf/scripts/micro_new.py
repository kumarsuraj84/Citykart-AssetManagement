"""Micro-benchmarks of individual new controls, run inside the ckam-pf-new api container (python /tmp/micro_new.py).
Pure CPU cost per call, no network. Prints JSON."""
import asyncio
import json
import statistics
import time
import timeit
from pathlib import Path

from app.core import static_safety
from app.core.body_limit import BodyLimitMiddleware
from app.core.security import burn_password_check, hash_password, verify_password

out = {}

# IF-01 lexical static-path check (no filesystem) and the full safe_asset_path (lexical + resolve + is_file)
name = "index-DflwEmrO.js"
n = 20000
out["is_safe_relative_name_us"] = round(timeit.timeit(lambda: static_safety.is_safe_relative_name(name), number=n) / n * 1e6, 2)
base = Path("/tmp/dist/assets")
n = 5000
out["safe_asset_path_us"] = round(timeit.timeit(lambda: static_safety.safe_asset_path(base, name), number=n) / n * 1e6, 2)
out["old_style_is_file_us"] = round(timeit.timeit(lambda: (base / name).is_file(), number=n) / n * 1e6, 2)

# AU-01 dummy password check on a refused sign-in = one Argon2 verify
h = hash_password("Perf#Test2026ok")
samples = []
for _ in range(15):
    t = time.perf_counter(); burn_password_check("Wrong#Pass2026"); samples.append((time.perf_counter() - t) * 1000)
out["burn_password_check_ms_median"] = round(statistics.median(samples), 2)
samples = []
for _ in range(15):
    t = time.perf_counter(); verify_password("Perf#Test2026ok", h); samples.append((time.perf_counter() - t) * 1000)
out["verify_password_ms_median"] = round(statistics.median(samples), 2)


# N1 body-limit middleware: a 4 MB body streamed in 64 KB chunks through the middleware to a no-op app
async def bench_body(chunks: int, chunk: bytes, wrap: bool) -> float:
    async def app(scope, receive, send):
        more = True
        while more:
            m = await receive()
            more = m.get("more_body", False)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    target = BodyLimitMiddleware(app) if wrap else app
    scope = {"type": "http", "method": "POST", "path": "/api/masters/vendors",
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(chunks * len(chunk)).encode())]}
    i = 0

    async def receive():
        nonlocal i
        i += 1
        return {"type": "http.request", "body": chunk, "more_body": i < chunks}

    async def send(_m):
        pass

    t = time.perf_counter()
    await target(scope, receive, send)
    return (time.perf_counter() - t) * 1e6


async def body_runs():
    chunk = b"x" * 65536
    res = {}
    for wrap in (False, True):
        vals = []
        for _ in range(30):
            vals.append(await bench_body(64, chunk, wrap))
        res["with_middleware" if wrap else "without_middleware"] = round(statistics.median(vals), 1)
    return res

out["body_4mb_64x64KB_us"] = asyncio.run(body_runs())
print(json.dumps(out, indent=1))
