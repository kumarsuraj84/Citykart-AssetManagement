"""GT step 5: start-up refusals of the PACKAGE (no database needed). Each case starts
`uvicorn app.main:app --no-proxy-headers --no-server-header` from the packaged backend with a clean environment and
records: started (startup complete) or refused (exit code), whether the message names the 32-character and
8-different-character rules, and whether the secret value appears anywhere in the output.
Output: CSV lines on stdout. Secrets used here are throw-away test strings."""
import csv, os, subprocess, sys, time, secrets, string

BACKEND = sys.argv[1]
GOOD = secrets.token_hex(32)                       # 64 chars, 16 distinct
envs = [("unset", None), ("blank", ""), ("prd", "prd"), ("live", "live"), ("prod-1", "prod-1"), ("garbage", "xq#garbage-env"),
        ("Production (caps)", "Production"), ("production", "production")]
weak = [
    ("missing", None),
    ("placeholder dev_secret_change_me", "dev_secret_change_me"),
    ("placeholder change_me_too", "change_me_too"),
    ("short 16", "Zq8#vL2!pW9$kR4m"),
    ("40 spaces", " " * 40),
    ("one repeated char x40", "a" * 40),
    ("31 chars, 31 distinct", "abcdefghijklmnopqrstuvwxyzABCDE"),
    ("low diversity 64 chars, 7 distinct", ("abcdefg" * 10)[:64]),
    ("padded short: 10 chars + 30 spaces", "Zq8#vL2!pW" + " " * 30),
]

def run(env_name, secret, wait=12.0):
    env = {"PATH": os.environ["PATH"], "HOME": "/tmp", "PYTHONPATH": BACKEND, "PYTHONDONTWRITEBYTECODE": "1",
           "DATABASE_URL": "postgresql+asyncpg://nobody:nopw@127.0.0.1:1/none", "LOG_DIR": "/tmp/gt-logs",
           "ERP_SYNC_ENABLED": "false"}
    if env_name is not None:
        env["ENVIRONMENT_NAME"] = env_name
    if secret is not None:
        env["JWT_SECRET"] = secret
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000",
                          "--no-proxy-headers", "--no-server-header"], cwd=BACKEND, env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0 = time.time(); out = ""
    started = False
    while time.time() - t0 < wait:
        if p.poll() is not None:
            break
        time.sleep(0.3)
    if p.poll() is None:
        started = True
        p.terminate()
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()
    out = p.stdout.read()
    return started, p.returncode, out

fh = open(sys.argv[2], "w", newline="")
w = csv.writer(fh)
w.writerow(["env_case", "secret_case", "started", "exit_code", "names_32_rule", "names_8_rule", "secret_printed", "first_refusal_line"])
cases = [(e, s) for e in envs for s in weak] + [(e, ("good random 64 hex", GOOD)) for e in envs if e[0] == "production"] \
    + [(("development (control)", "development"), ("short 16", "Zq8#vL2!pW9$kR4m"))]
for (en, ev), (sn, sv) in cases:
    started, code, out = run(ev, sv)
    printed = bool(sv and sv.strip() and len(sv.strip()) >= 6 and sv.strip() in out)
    line = next((l.strip() for l in out.splitlines() if "Refusing to start" in l), "")
    complete = "Application startup complete" in out
    w.writerow([en, sn, "yes" if (started and complete) else "no", code, "32 characters" in out, "8 different characters" in out, printed, line[:400]])
    fh.flush(); print(en, "|", sn, "|", "started" if (started and complete) else f"refused exit {code}", flush=True)
