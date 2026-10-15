"""IF-T: path-traversal probe of the single-port production static routes (/assets/{path}, /{path}).
Runs INSIDE a throw-away, network-less copy of the ckam-sec api image, against uvicorn on 127.0.0.1:8000
with FRONTEND_DIST_DIR=/tmp/dist. A canary file /tmp/secret_outside.txt lives OUTSIDE the dist dir."""
import http.client

PATHS = [
    "/assets/a.js",
    "/assets/../../secret_outside.txt",
    "/assets/..%2f..%2fsecret_outside.txt",
    "/assets/%2e%2e/%2e%2e/secret_outside.txt",
    "/assets/..%2F..%2F..%2Fetc%2Fpasswd",
    "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/assets/....//....//secret_outside.txt",
    "/assets//etc/passwd",
    "/assets/%2fetc%2fpasswd",
    "/..%2f..%2fsecret_outside.txt",
    "/favicon.svg",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
]

for p in PATHS:
    c = http.client.HTTPConnection("127.0.0.1", 8000, timeout=5)
    c.putrequest("GET", p, skip_accept_encoding=True)
    c.endheaders()
    r = c.getresponse()
    body = r.read()[:80]
    leak = b"CANARY" in body or b"root:" in body
    print(f"{r.status}\t{'LEAK' if leak else '-'}\t{p}\t{body[:40]!r}")
