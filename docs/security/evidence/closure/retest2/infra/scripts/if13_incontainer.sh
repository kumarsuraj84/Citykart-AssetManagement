#!/bin/sh
# CL2-IF IF-13 in-container checks. Run as the container's default user:
#   docker exec -i <container> sh -s < if13_incontainer.sh
# Read-only except for the probe files it creates and removes itself.
echo "== identity"
id
echo "whoami: $(whoami 2>/dev/null || echo '(no passwd name)')"
echo "== /proc/1/status (uid, gid, caps, NoNewPrivs, Seccomp)"
grep -E '^(Name|Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):' /proc/1/status
echo "== /proc/self/status of this exec shell"
grep -E '^(Uid|CapEff|CapBnd|NoNewPrivs):' /proc/self/status
echo "== PID 1 command line"
tr '\0' ' ' < /proc/1/cmdline; echo
echo "== write probes (expected: only /data/uploads, /data/logs, /tmp writable)"
for d in / /app /app/app /app/scripts /usr /usr/local/lib /usr/local/bin /etc /root /var /var/tmp /opt /home /srv /data /data/uploads /data/logs /tmp /dev/shm; do
  f="$d/.ckam_r2c_probe_$$"
  if ( : > "$f" ) 2>/dev/null; then echo "WRITABLE  $d"; rm -f "$f"; else echo "denied    $d"; fi
done
echo "== modify existing files (expected: denied)"
for f in /app/app/main.py /etc/passwd /usr/local/bin/uvicorn /app/alembic.ini; do
  if [ -e "$f" ]; then
    if ( : >> "$f" ) 2>/dev/null; then echo "WRITABLE  $f"; else echo "denied    $f"; fi
  fi
done
echo "== world-writable directories outside /tmp, /proc, /sys, /dev"
find / -xdev -type d -perm -0002 2>/dev/null | grep -vE '^/(proc|sys|dev|tmp)' | head -20
echo "== setuid/setgid binaries (no-new-privileges makes them harmless; listed for the record)"
find / -xdev -perm /6000 -type f 2>/dev/null | head -20
echo "== ownership of data dirs"
ls -land /app /data/uploads /data/logs /tmp
echo "== test tooling present?"
if [ -d /app/tests ]; then echo "tests dir: PRESENT ($(ls /app/tests | wc -l) entries)"; else echo "tests dir: absent"; fi
for m in pytest _pytest coverage pytest_asyncio pytest_cov; do
  if python -c "import $m" 2>/dev/null; then echo "module $m: PRESENT"; else echo "module $m: absent"; fi
done
if command -v pytest >/dev/null 2>&1; then echo "pytest command: PRESENT"; else echo "pytest command: absent"; fi
echo "== privilege escalation attempts"
if command -v su >/dev/null 2>&1; then (echo x | su -c id root) 2>&1 | head -2; fi
if command -v sudo >/dev/null 2>&1; then sudo -n id 2>&1 | head -1; else echo "sudo: not installed"; fi
python -c "import os
try:
    os.setuid(0); print('setuid(0): SUCCEEDED')
except Exception as e:
    print('setuid(0): refused', type(e).__name__)
try:
    os.chown('/data/uploads', 0, 0); print('chown to root: SUCCEEDED')
except Exception as e:
    print('chown to root: refused', type(e).__name__)
import socket
try:
    s=socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP); print('raw socket: OPENED')
except Exception as e:
    print('raw socket: refused', type(e).__name__)
try:
    s=socket.socket(); s.bind(('0.0.0.0', 80)); print('bind port 80: SUCCEEDED')
except Exception as e:
    print('bind port 80: refused', type(e).__name__)
"
echo "== done"
