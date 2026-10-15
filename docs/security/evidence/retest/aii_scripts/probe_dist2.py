"""RT-AU (retest IF-01/IN-01): path-traversal probe of the single-port production static routes.
Runs INSIDE a throw-away, network-less container of the rebuilt ckam-sec-api image (HEAD ae706bb), against
uvicorn on 127.0.0.1:<port> with FRONTEND_DIST_DIR=/tmp/root/releases/abc/frontend-dist (production layout).
All secrets are FAKE canaries created by setup below. Raw http.client request lines (no client normalisation)."""
import http.client
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

PATHS = [
    # (label, path, expect_status_set)
    ("control asset", "/assets/a.js", {200}),
    ("control nested asset", "/assets/sub/b.css", {200}),
    ("raw ../ (unencoded)", "/assets/../../secret_outside.txt", {404}),
    ("..%2f encoded x2 -> dist", "/assets/..%2f..%2fsecret_outside.txt", {404}),
    ("%2e%2e/ encoded dots", "/assets/%2e%2e/%2e%2e/secret_outside.txt", {404}),
    ("..%2F upper to /etc/passwd", "/assets/..%2F..%2F..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd", {404}),
    ("all-encoded %2e%2e%2f to /etc/passwd", "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd", {404}),
    ("double-encoded %252e%252e%252f", "/assets/%252e%252e%252f%252e%252e%252fsecret_outside.txt", {404}),
    ("....// filter-bypass", "/assets/....//....//secret_outside.txt", {404}),
    ("absolute //etc/passwd", "/assets//etc/passwd", {404}),
    ("absolute %2fetc%2fpasswd", "/assets/%2fetc%2fpasswd", {404}),
    ("backslash ..%5c", "/assets/..%5c..%5c..%5c..%5cshared%5c.env", {404}),
    ("mixed ..%5c/..%2f", "/assets/..%5c..%2f..%2f..%2f..%2fshared/.env", {404}),
    ("tomcat ..;/", "/assets/..;/..;/..;/..;/shared/.env", {404}),
    ("NUL %00 in name", "/assets/a.js%00.png", {404}),
    ("NUL then traversal", "/assets/..%2f..%2f..%2f..%2fshared%2f.env%00", {404}),
    ("overlong utf8 %c0%ae", "/assets/%c0%ae%c0%ae/%c0%ae%c0%ae/secret_outside.txt", {404}),
    ("sibling prefix dir assets-evil", "/assets/..%2fassets-evil%2fsecret.txt", {404}),
    ("sibling prefix dir frontend-dist-evil", "/assets/..%2f..%2ffrontend-dist-evil%2fsecret.txt", {404}),
    ("dist index.html via ..", "/assets/..%2findex.html", {404}),
    ("symlink inside assets -> outside", "/assets/link_out.txt", {404}),
    ("dir itself", "/assets/sub", {404}),
    ("prod layout shared/.env", "/assets/..%2f..%2f..%2f..%2fshared%2f.env", {404}),
    ("prod layout shared/nas.pw", "/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw", {404}),
    ("climb out and back in (legit file)", "/assets/..%2f..%2f..%2f..%2freleases%2fabc%2ffrontend-dist%2fassets%2fa.js", {200}),
    # SPA shell route /{full_path} and the favicon list
    ("shell traversal", "/..%2f..%2f..%2f..%2fshared%2f.env", {200}),
    ("shell traversal raw", "/../../../../shared/.env", {200}),
    ("shell absolute", "//etc/passwd", {200}),
    ("favicon.svg (allow-list)", "/favicon.svg", {200}),
    ("logo.png (allow-list)", "/logo.png", {200}),
    ("favicon list + traversal", "/favicon.svg%2f..%2f..%2f..%2f..%2fshared%2f.env", {200}),
    ("root non-listed file", "/secret_in_dist.txt", {200}),
    ("api health", "/api/health", {200}),
    ("/docs", "/docs", None),
    ("/redoc", "/redoc", None),
    ("/openapi.json", "/openapi.json", None),
]

MARKERS = (b"CANARY", b"root:x:", b"DIST-SECRET")


def main():
    fails = 0
    for label, p, expect in PATHS:
        c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
        c.putrequest("GET", p, skip_accept_encoding=True)
        c.endheaders()
        r = c.getresponse()
        body = r.read()
        leak = any(m in body for m in MARKERS)
        is_shell = b"<html>shell</html>" in body
        ok = (not leak) and (expect is None or r.status in expect)
        if not ok:
            fails += 1
        print(f"{'PASS' if ok else 'FAIL'}\t{r.status}\t{'LEAK' if leak else ('shell' if is_shell else '-')}\t{label}\t{p}\t{body[:40]!r}")
    print(f"TOTAL {len(PATHS)} FAIL {fails}")


if __name__ == "__main__":
    main()
