"""CL3 IF-04 single-port production probe. Raw request lines (no client-side normalisation) to 127.0.0.1:8400.
Covers: (a) the app routes /assets/<id> and /assets/new must return the HTML shell with Cache-Control: no-cache;
(b) every path-traversal / Windows / encoding payload AND missing .js/.css/.map must be an IDENTICAL plain 404
(no secret leak, no 5xx, no JSON); (c) the 'route-looking name' fallback must NEVER serve a disk file -- canary
files named exactly like routes (123, new, settings, CON, a 65-char name...) must not leak. Also HEAD/OPTIONS/POST.
A leak = body contains CANARY or 'root:'."""
import http.client

HOST, PORT = "127.0.0.1", 8400

# (method, path, label, expectation)  expectation in {shell, asset, 404}
CASES = [
    # --- app routes: must return index.html shell (200), NOT a disk file ---
    ("GET", "/assets/123", "route-numeric-id", "shell"),
    ("GET", "/assets/new", "route-new", "shell"),
    ("GET", "/assets/settings", "route-settings", "shell"),
    ("GET", "/assets/42/edit", "route-2seg", "shell"),
    ("GET", "/assets/a/b/c", "route-3seg", "shell"),
    ("GET", "/assets/ABC-123_x", "route-mixedchars", "shell"),
    # --- legit hashed assets: must return the file (200) ---
    ("GET", "/assets/a.js", "legit-js", "asset"),
    ("GET", "/assets/index-A1b2C3d4.js", "legit-hashed", "asset"),
    ("GET", "/assets/app-Z9y8X7w6.css", "legit-css", "asset"),
    # --- missing hashed files: plain 404 (never shell/200) ---
    ("GET", "/assets/missing-00000000.js", "missing-js", "404"),
    ("GET", "/assets/missing-00000000.css", "missing-css", "404"),
    ("GET", "/assets/index-DEADBEEF.js.map", "missing-map", "404"),
    ("GET", "/assets/vendor-123.map", "missing-map2", "404"),
    # --- route-looking canary files on disk: MUST return shell, never the file ---
    ("GET", "/assets/new", "canary-file-new", "shell"),
    ("GET", "/assets/123", "canary-file-123", "shell"),
    ("GET", "/assets/settings", "canary-file-settings", "shell"),
    # --- device names (whole name and as segment) ---
    ("GET", "/assets/CON", "device-con", "404"),
    ("GET", "/assets/nul", "device-nul", "404"),
    ("GET", "/assets/AUX", "device-aux", "404"),
    ("GET", "/assets/COM1", "device-com1", "404"),
    ("GET", "/assets/CON.js", "device-con-js", "404"),
    ("GET", "/assets/foo/CON", "device-seg", "404"),
    ("GET", "/assets/CON/foo", "device-seg2", "404"),
    # --- path traversal: Linux ---
    ("GET", "/assets/../../secret_outside.txt", "dotdot-raw", "404"),
    ("GET", "/assets/..%2f..%2fsecret_outside.txt", "enc-slash", "404"),
    ("GET", "/assets/%2e%2e/%2e%2e/secret_outside.txt", "enc-dot", "404"),
    ("GET", "/assets/..%2F..%2F..%2Fetc%2Fpasswd", "etcpasswd", "404"),
    ("GET", "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd", "etcpasswd-allenc", "404"),
    ("GET", "/assets/....//....//secret_outside.txt", "quad-dot", "404"),
    ("GET", "/assets//etc/passwd", "double-slash-abs", "404"),
    ("GET", "/assets/%2fetc%2fpasswd", "enc-abs", "404"),
    ("GET", "/assets/..%2f..%2f..%2f..%2fshared%2f.env", "prod-env-canary", "404"),
    ("GET", "/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw", "prod-naspw-canary", "404"),
    # --- Windows payloads ---
    ("GET", "/assets/..%5c..%5csecret_outside.txt", "winsep-5c", "404"),
    ("GET", "/assets/%2e%2e%5c%2e%2e%5csecret_outside.txt", "winsep-dot5c", "404"),
    ("GET", "/assets/C:%2fWindows%2fwin.ini", "win-drive-fslash", "404"),
    ("GET", "/assets/C:%5cWindows%5cwin.ini", "win-drive-bslash", "404"),
    ("GET", "/assets/%5c%5cserver%5cshare", "unc-share", "404"),
    ("GET", "/assets/..%2f..%5c..%2fsecret_outside.txt", "mixed-slash", "404"),
    ("GET", "/assets/index-A1b2C3d4.js::$DATA", "ads-stream", "404"),
    # --- double / overlong encoding ---
    ("GET", "/assets/%252e%252e%252f%252e%252e%252fsecret_outside.txt", "double-enc-dot", "404"),
    ("GET", "/assets/..%252f..%252fsecret_outside.txt", "double-enc-slash", "404"),
    ("GET", "/assets/%c0%ae%c0%ae%2fsecret_outside.txt", "overlong-c0ae", "404"),
    ("GET", "/assets/%u002e%u002e%2fsecret_outside.txt", "iis-u-encode", "404"),
    # --- sibling-prefix dir / symlink ---
    ("GET", "/assets/../assets_evil/canary.txt", "sibling-prefix", "404"),
    ("GET", "/assets/..%2fassets_evil%2fcanary.txt", "sibling-prefix-enc", "404"),
    ("GET", "/assets/link_out.txt", "symlink-out", "404"),
    # --- NUL / whitespace / unicode lookalikes ---
    ("GET", "/assets/a%00.js", "nul-mid", "404"),
    ("GET", "/assets/..%2f..%2fsecret_outside.txt%00.js", "nul-suffix", "404"),
    ("GET", "/assets/%20new", "leading-space", "404"),
    ("GET", "/assets/new%20", "trailing-space", "404"),
    ("GET", "/assets/%ef%bc%8e%ef%bc%8e%ef%bc%8fsecret_outside.txt", "fullwidth-dotslash", "404"),
    ("GET", "/assets/%e2%88%95etc%e2%88%95passwd", "unicode-divslash", "404"),
    # --- overlong segments / too many segments / empty segments ---
    ("GET", "/assets/" + "a" * 65, "overlong-65", "404"),
    ("GET", "/assets/" + "a" * 220, "overlong-220", "404"),
    ("GET", "/assets/a/b/c/d", "four-segments", "404"),
    ("GET", "/assets//", "empty-seg", "404"),
    ("GET", "/assets/a//b", "empty-mid-seg", "404"),
    # --- catch-all shell route sanity (must be shell, never a file read) ---
    ("GET", "/..%2f..%2fsecret_outside.txt", "catchall-traversal", "shell_or_404"),
    ("GET", "/some/client/route", "catchall-route", "shell"),
    ("GET", "/api/health", "health", "json"),
    # --- method variations on an app route ---
    ("HEAD", "/assets/123", "head-route", "any"),
    ("OPTIONS", "/assets/123", "options-route", "any"),
    ("POST", "/assets/123", "post-route", "any"),
    ("HEAD", "/assets/../../secret_outside.txt", "head-traversal", "any"),
]

bodies_404 = {}
rows = []
for method, path, label, expect in CASES:
    try:
        c = http.client.HTTPConnection(HOST, PORT, timeout=6)
        c.putrequest(method, path, skip_accept_encoding=True)
        c.endheaders()
        r = c.getresponse()
        body = r.read()
        cc = r.getheader("Cache-Control")
        ct = r.getheader("Content-Type")
        leak = (b"CANARY" in body) or (b"root:" in body) or (b"SHELL-NOT" in body and False)
        is_shell = b"<html>shell</html>" in body
        rows.append((method, r.status, "LEAK" if leak else "-", "SHELL" if is_shell else "-",
                     label, expect, cc, ct, path, body[:40]))
        if r.status == 404:
            bodies_404.setdefault(body, []).append(label)
        c.close()
    except Exception as e:
        rows.append((method, "ERR", "-", "-", label, expect, None, None, path, str(e)[:40].encode()))

print("meth stat leak shell label                 expect       cache-control   ctype                 path")
for m, st, lk, sh, label, ex, cc, ct, path, snip in rows:
    print(f"{m:<4} {str(st):<4} {lk:<4} {sh:<5} {label:<21} {ex:<12} {str(cc):<15} {str(ct):<21} {path}")
    print(f"       body[:40]={snip!r}")

print("\n# distinct 404 bodies:", len(bodies_404))
for body, labels in bodies_404.items():
    print(f"  {body[:90]!r}  <- {len(labels)}: {labels}")

leaks = [r for r in rows if r[2] == "LEAK"]
# Any payload that is NOT an app-route/legit/health but returned the shell when a canary file of that name exists
canary_served = [r for r in rows if r[4].startswith("canary-file") and r[3] != "SHELL"]
shell_expected_fail = [r for r in rows if r[5] == "shell" and r[3] != "SHELL" and r[1] not in ("ERR",)]
file404_fail = [r for r in rows if r[5] == "404" and r[1] not in (404, 400)]
print("\nLEAKS:", len(leaks), [r[4] for r in leaks])
print("canary file served instead of shell:", len(canary_served), [r[4] for r in canary_served])
print("expected-shell but not shell:", len(shell_expected_fail), [(r[4], r[1]) for r in shell_expected_fail])
print("expected-404 but not 404/400:", len(file404_fail), [(r[4], r[1]) for r in file404_fail])
