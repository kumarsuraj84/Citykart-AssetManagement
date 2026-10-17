"""GT: run the PACKAGED Alembic (cwd = the package's backend folder) against the throw-away DB in DATABASE_URL and
time each command. usage: python -I alembic_run.py <backend dir> <cmd> [<cmd> ...]
   cmd = current | heads | up:<rev> | down:<rev>   (each is one alembic process, timed wall-clock)"""
import os, subprocess, sys, time
backend = sys.argv[1]
env = dict(os.environ)
env["PYTHONPATH"] = backend
url = env.get("DATABASE_URL", "")
assert "@ckam-gate-db:" in url, "refusing: DATABASE_URL is not the gate DB"
total = 0.0
for cmd in sys.argv[2:]:
    if cmd in ("current", "heads", "history"):
        args = [cmd]
    else:
        verb, rev = cmd.split(":", 1)
        args = ["upgrade" if verb == "up" else "downgrade", rev]
    t0 = time.perf_counter()
    p = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=backend, env=env, capture_output=True, text=True)
    dt = time.perf_counter() - t0
    if cmd.startswith(("up:", "down:")):
        total += dt
    out = (p.stdout + p.stderr).strip().replace(url, "<DATABASE_URL>")
    print(f"=== alembic {' '.join(args)}  exit={p.returncode}  wall={dt*1000:.0f} ms")
    print(out)
    if p.returncode != 0:
        sys.exit(p.returncode)
print(f"=== total wall time of upgrade/downgrade commands: {total*1000:.0f} ms")
