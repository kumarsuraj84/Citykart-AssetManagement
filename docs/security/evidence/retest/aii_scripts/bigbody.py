"""RT AU-15 residual: single-port production (uvicorn, no nginx) -- is there any request-body cap?
Sends one large unauthenticated JSON body to /api/auth/login and one large multipart to an import endpoint,
measuring status, time and the uvicorn process RSS (throw-away, network-less container only)."""
import http.client
import os
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
MB = int(sys.argv[2]) if len(sys.argv) > 2 else 64


def uvicorn_rss_kb():
    best = 0
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read()
            if not cmd.startswith(b"sh") and b"uvicorn" in cmd and f"{PORT}".encode() in cmd:
                for line in open(f"/proc/{pid}/status"):
                    if line.startswith("VmRSS") or line.startswith("VmHWM"):
                        pass
                hwm = [l for l in open(f"/proc/{pid}/status") if l.startswith("VmHWM")][0].split()[1]
                rss = [l for l in open(f"/proc/{pid}/status") if l.startswith("VmRSS")][0].split()[1]
                return int(rss), int(hwm)
        except Exception:
            continue
    return best, best


def send(path, body, ctype):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=120)
    t = time.time()
    c.request("POST", path, body=body, headers={"Content-Type": ctype, "Content-Length": str(len(body))})
    r = c.getresponse()
    data = r.read()[:160]
    return r.status, round(time.time() - t, 2), data


print("before rss/hwm kB", uvicorn_rss_kb())
pad = b"a" * (MB * 1024 * 1024)
body = b'{"login_id":"x","password":"' + pad + b'"}'
print(f"login {MB} MB JSON ->", send("/api/auth/login", body, "application/json"))
print("after login rss/hwm kB", uvicorn_rss_kb())
boundary = "rtbound"
mp = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.xlsx\"\r\n"
      f"Content-Type: application/octet-stream\r\n\r\n").encode() + pad + f"\r\n--{boundary}--\r\n".encode()
print(f"unauthenticated import {MB} MB multipart ->", send("/api/imports/assets/preview", mp, f"multipart/form-data; boundary={boundary}"))
print("after multipart rss/hwm kB", uvicorn_rss_kb())
