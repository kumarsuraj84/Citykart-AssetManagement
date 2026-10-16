"""CL1 N1 raw-socket cases, run INSIDE ckam-sec-api-1 against loopback uvicorn (127.0.0.1:8000).
Content-Length edge values, chunked oversized body (no Content-Length), Expect: 100-continue, slow-body
concurrency, and a 256 MB body memory-balloon check. Prints status lines only (no secrets)."""
import socket
import threading
import time

HOST, PORT = "127.0.0.1", 8000
LIMIT_AUTH = 64 * 1024


def rss_hwm_kb():
    rss = hwm = 0
    for line in open("/proc/1/status"):
        if line.startswith("VmRSS"):
            rss = int(line.split()[1])
        elif line.startswith("VmHWM"):
            hwm = int(line.split()[1])
    return rss, hwm


def raw(path, headers, body=b"", read_bytes=300, timeout=20, send_body=True):
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    req = f"POST {path} HTTP/1.1\r\nHost: localhost\r\n"
    for k, v in headers.items():
        req += f"{k}: {v}\r\n"
    req += "\r\n"
    s.sendall(req.encode())
    if send_body and body:
        try:
            s.sendall(body)
        except Exception as e:
            pass
    try:
        data = s.recv(read_bytes)
    except Exception as e:
        data = f"<recv error {e}>".encode()
    s.close()
    first = data.split(b"\r\n", 1)[0].decode(errors="replace")
    return first, data


def status_line_only(first):
    return first


print("== N1 raw cases ==")
r0 = rss_hwm_kb()
print(f"baseline rss/hwm kB = {r0}")

# 1. huge Content-Length, tiny real body -> expect 413 on the header (no body read)
first, _ = raw("/api/auth/login", {"Content-Type": "application/json", "Content-Length": "268435456"},
               body=b'{"login_id":"x","password":"a"}', send_body=True)
print(f"[huge CL 256MB declared, 31B sent] -> {first}")
print(f"  rss/hwm after = {rss_hwm_kb()}")

# 2. negative Content-Length
first, _ = raw("/api/auth/login", {"Content-Type": "application/json", "Content-Length": "-1"},
               body=b'{"login_id":"x","password":"a"}')
print(f"[negative CL -1] -> {first}")

# 3. malformed Content-Length
first, _ = raw("/api/auth/login", {"Content-Type": "application/json", "Content-Length": "abc"},
               body=b'{"login_id":"x","password":"a"}')
print(f"[malformed CL 'abc'] -> {first}")

# 4. chunked oversized, no Content-Length (>64KB) to auth
def chunked_body(total):
    out = b""
    chunk = b"a" * 8192
    sent = 0
    while sent < total:
        out += (b"%X\r\n" % len(chunk)) + chunk + b"\r\n"
        sent += len(chunk)
    out += b"0\r\n\r\n"
    return out

first, data = raw("/api/auth/login", {"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
                  body=chunked_body(200 * 1024))
print(f"[chunked ~200KB no CL to auth] -> {first}")
print(f"  body snip: {data[-120:]!r}")
print(f"  rss/hwm after = {rss_hwm_kb()}")

# 5. Expect: 100-continue with huge CL -> server should refuse (413) without asking us to send
s = socket.create_connection((HOST, PORT), timeout=15)
s.sendall(b"POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
          b"Content-Length: 10485760\r\nExpect: 100-continue\r\n\r\n")
time.sleep(1.5)
try:
    resp = s.recv(300)
except Exception as e:
    resp = f"<recv error {e}>".encode()
print(f"[Expect: 100-continue + 10MB CL] -> {resp.split(chr(13).encode()+chr(10).encode(),1)[0].decode(errors='replace')}")
s.close()

# 6. slow-body: declare CL=2000, send 1KB then stall; meanwhile a normal /api/health must answer fast
def slow_body():
    ss = socket.create_connection((HOST, PORT), timeout=40)
    ss.sendall(b"POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
               b"Content-Length: 2000\r\n\r\n")
    ss.sendall(b"a" * 1024)
    time.sleep(8)        # stall holding the request open
    try:
        ss.sendall(b"a" * 976)
        ss.recv(100)
    except Exception:
        pass
    ss.close()

t = threading.Thread(target=slow_body)
t.start()
time.sleep(1.0)           # let the slow body stall
# fire a normal health request and time it
h = socket.create_connection((HOST, PORT), timeout=10)
t0 = time.time()
h.sendall(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
hd = h.recv(300)
dt = time.time() - t0
h.close()
print(f"[health during stalled slow-body] -> {hd.split(chr(13).encode()+chr(10).encode(),1)[0].decode(errors='replace')} in {dt:.2f}s")
t.join()

# 7. 256 MB real body, correct Content-Length -> 413 on header; server must not read it -> RSS flat
before = rss_hwm_kb()
s = socket.create_connection((HOST, PORT), timeout=30)
s.sendall(b"POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
          b"Content-Length: 268435456\r\n\r\n")
# try to push a lot of body; server likely 413s and closes early
pushed = 0
blob = b"a" * (1024 * 1024)
try:
    s.settimeout(8)
    # read response first (server refuses on CL before reading)
    time.sleep(0.5)
    resp = s.recv(300)
    print(f"[256MB real send] response before pushing body -> {resp.split(chr(13).encode()+chr(10).encode(),1)[0].decode(errors='replace')}")
except Exception as e:
    resp = b""
    print(f"[256MB real send] no early response ({e}); pushing body...")
try:
    for _ in range(256):
        s.sendall(blob)
        pushed += len(blob)
except Exception as e:
    pass
after = rss_hwm_kb()
print(f"  pushed ~{pushed // (1024*1024)} MB; rss/hwm before={before} after={after}")
s.close()

print("== final rss/hwm kB ==", rss_hwm_kb())
