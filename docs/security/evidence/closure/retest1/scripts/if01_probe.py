"""CL1 IF-01 traversal probe. Raw request lines (no client-side normalisation) to 127.0.0.1:8400.
Any body containing CANARY or 'root:' is a LEAK. Expected: every traversal 404, legit hashed assets 200,
no 500 and the SAME 404 body for every blocked path."""
import http.client

PATHS = [
    # legitimate hashed assets (expect 200)
    ("/assets/a.js", "legit"),
    ("/assets/index-A1b2C3d4.js", "legit-hashed"),
    # Linux / basic traversal (expect 404)
    ("/assets/../../secret_outside.txt", "dotdot-raw"),
    ("/assets/..%2f..%2fsecret_outside.txt", "enc-slash"),
    ("/assets/%2e%2e/%2e%2e/secret_outside.txt", "enc-dot"),
    ("/assets/..%2F..%2F..%2Fetc%2Fpasswd", "etcpasswd-ucslash"),
    ("/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd", "etcpasswd-allenc"),
    ("/assets/....//....//secret_outside.txt", "quad-dot"),
    ("/assets//etc/passwd", "double-slash-abs"),
    ("/assets/%2fetc%2fpasswd", "enc-abs"),
    ("/assets/..%2f..%2f..%2f..%2fshared%2f.env", "prod-env-canary"),
    ("/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw", "prod-naspw-canary"),
    # Windows-style payloads (expect 404)
    ("/assets/..%5c..%5csecret_outside.txt", "winsep-5c"),
    ("/assets/%2e%2e%5c%2e%2e%5csecret_outside.txt", "winsep-dot5c"),
    ("/assets/C:%2fWindows%2fwin.ini", "win-drive-fslash"),
    ("/assets/C:%5cWindows%5cwin.ini", "win-drive-bslash"),
    ("/assets/%5c%5cserver%5cshare", "unc-share"),
    ("/assets/..%2f..%5c..%2fsecret_outside.txt", "mixed-slash"),
    # double-encoded (expect 404)
    ("/assets/%252e%252e%252f%252e%252e%252fsecret_outside.txt", "double-enc-dot"),
    ("/assets/..%252f..%252fsecret_outside.txt", "double-enc-slash"),
    # sibling-prefix dir (expect 404 -- assets_evil is a sibling of assets)
    ("/assets/../assets_evil/canary.txt", "sibling-prefix"),
    ("/assets/..%2fassets_evil%2fcanary.txt", "sibling-prefix-enc"),
    # symlink inside assets pointing outside (expect 404)
    ("/assets/link_out.txt", "symlink-out"),
    # NUL byte (expect 404/400)
    ("/assets/a%00.js", "nul-mid"),
    ("/assets/..%2f..%2fsecret_outside.txt%00.js", "nul-suffix"),
    # catch-all shell route sanity (expect 200 index.html, never a file read)
    ("/..%2f..%2fsecret_outside.txt", "catchall-shell"),
    ("/api/health", "health"),
]

bodies_404 = {}
rows = []
for path, label in PATHS:
    c = http.client.HTTPConnection("127.0.0.1", 8400, timeout=5)
    c.putrequest("GET", path, skip_accept_encoding=True)
    c.endheaders()
    r = c.getresponse()
    body = r.read()
    leak = (b"CANARY" in body) or (b"root:" in body)
    snippet = body[:40]
    rows.append((r.status, "LEAK" if leak else "-", label, path, snippet))
    if r.status == 404:
        bodies_404.setdefault(body, []).append(label)
    c.close()

print("status leak  label                 path                                              body[:40]")
for st, lk, label, path, snip in rows:
    print(f"{st:<6} {lk:<5} {label:<21} {path:<49} {snip!r}")

print("\n# distinct 404 bodies:", len(bodies_404))
for body, labels in bodies_404.items():
    print(f"  {body[:80]!r}  <- {len(labels)} paths")

leaks = [r for r in rows if r[1] == "LEAK"]
non404_traversal = [r for r in rows if r[2] not in ("legit", "legit-hashed", "health", "catchall-shell") and r[0] not in (404, 400)]
print("\nLEAKS:", len(leaks), "| traversal paths not 404/400:", len(non404_traversal))
