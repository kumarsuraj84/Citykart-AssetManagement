"""RT AU-14/AU-15 in single-port production mode: headers on 200/401/404/405/422 + SPA shell + asset."""
import http.client
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
CASES = [
    ("GET", "/api/health", None, None),
    ("GET", "/api/auth/capabilities", None, None),            # 401
    ("GET", "/api/nope", None, None),                         # 404 JSON
    ("GET", "/assets/missing.js", None, None),                # 404 asset
    ("GET", "/assets/a.js", None, None),                      # asset 200
    ("GET", "/some/spa/route", None, None),                   # shell
    ("POST", "/api/auth/login", b'{"login_id":1}', "application/json"),  # 422
    ("TRACE", "/api/health", None, None),
    ("GET", "/assets/x.js.map", None, None),
]
WANT = ("server", "content-security-policy", "permissions-policy", "x-content-type-options", "x-frame-options",
        "referrer-policy", "cache-control", "x-request-id")
for method, path, body, ctype in CASES:
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    h = {"Content-Type": ctype} if ctype else {}
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    r.read()
    hd = {k.lower(): v for k, v in r.getheaders()}
    present = {k: ("Y" if k in hd else "-") for k in WANT}
    print(f"{method} {path} -> {r.status} | server={hd.get('server','<none>')} | csp={present['content-security-policy']} "
          f"pp={present['permissions-policy']} xcto={present['x-content-type-options']} xfo={present['x-frame-options']} "
          f"rp={present['referrer-policy']} cc={hd.get('cache-control','-')} rid={present['x-request-id']}")
