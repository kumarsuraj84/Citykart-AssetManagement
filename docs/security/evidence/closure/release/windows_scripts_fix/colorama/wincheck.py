# pip evaluates environment markers against the RUNNING (Linux) interpreter even with --platform, so a plain
# "--platform win_amd64" dry run neither shows colorama nor drops uvloop. This script computes the dependency
# closure of the backend's runtime requirements with the markers evaluated for Windows / CPython 3.13 / AMD64,
# using the package metadata (requires_dist) of a Linux dry-run report, plus the METADATA of any wheel that only
# Windows needs (given as extra arguments). Then it checks every Windows package against the constraints file.
# Usage: wincheck.py <linux report.json> <requirements.txt> <constraints.txt> [extra wheel ...]
import json, sys, zipfile
from email.parser import Parser
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name as canon

WIN = {"os_name": "nt", "sys_platform": "win32", "platform_system": "Windows", "platform_machine": "AMD64",
       "platform_release": "10", "platform_version": "10.0.20348", "implementation_name": "cpython",
       "platform_python_implementation": "CPython", "python_version": "3.13", "python_full_version": "3.13.0",
       "implementation_version": "3.13.0"}
LINUX = dict(WIN, os_name="posix", sys_platform="linux", platform_system="Linux", platform_machine="x86_64")

report, reqfile, consfile, wheels = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
meta = {canon(i["metadata"]["name"]): (i["metadata"]["version"], i["metadata"].get("requires_dist") or [])
        for i in json.load(open(report, encoding="utf-8"))["install"]}
for w in wheels:
    with zipfile.ZipFile(w) as z:
        name = next(n for n in z.namelist() if n.endswith(".dist-info/METADATA"))
        m = Parser().parsestr(z.read(name).decode("utf-8"))
        meta[canon(m["Name"])] = (m["Version"], m.get_all("Requires-Dist") or [])
        print(f"wheel {w.rsplit('/', 1)[-1]}: Requires-Dist = {m.get_all('Requires-Dist') or 'none'}")

pins = {}
for line in open(consfile, encoding="utf-8"):
    line = line.split("#", 1)[0].strip()
    if "==" in line:
        a, b = line.split("==", 1)
        pins[canon(a)] = b.strip()

def closure(env):
    seen, missing, queue = {}, set(), [Requirement(l.strip()) for l in open(reqfile) if l.strip()]
    while queue:
        r = queue.pop()
        n, extras = canon(r.name), set(r.extras)
        if n in seen and extras <= seen[n]:
            continue
        seen.setdefault(n, set()).update(extras)
        if n not in meta:
            missing.add(n)
            continue
        for rd in meta[n][1]:
            d = Requirement(rd)
            if d.marker is None or any(d.marker.evaluate(dict(env, extra=e)) for e in ({""} | seen[n])):
                queue.append(d)
    return seen, missing

win, win_missing = closure(WIN)
lin, _ = closure(LINUX)
print(f"Windows closure: {len(win)} packages; Linux closure: {len(lin)} packages")
print("only on Windows:", sorted(set(win) - set(lin)))
print("only on Linux:  ", sorted(set(lin) - set(win)))
print("Windows packages without metadata here (not resolved further):", sorted(win_missing) or "none")
bad = 0
for n in sorted(win):
    pin = pins.get(n)
    ver = meta.get(n, ("?",))[0]
    state = "ok" if pin and pin == ver else ("UNPINNED" if not pin else f"MISMATCH pin {pin}")
    bad += state != "ok"
    print(f"  {state:9} {n}=={ver}")
print(f"WINDOWS RESULT: {len(win)} packages, {len(win) - bad} at their pin, {bad} unpinned/mismatched")
with open("/w/win_pins.txt", "w") as f:
    for n in sorted(win):
        f.write(f"{n}=={pins.get(n, meta[n][0])}\n")
