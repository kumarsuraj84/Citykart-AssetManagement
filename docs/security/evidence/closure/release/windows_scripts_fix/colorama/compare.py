# Compares a `pip install --dry-run --report` JSON with a constraints file: every resolved package must be pinned
# and resolve to exactly its pin. Prints one line per package and a summary. Usage: compare.py <report> <constraints>
import json, re, sys

def norm(n):
    return re.sub(r"[-_.]+", "-", n).lower()

pins = {}
for line in open(sys.argv[2], encoding="utf-8"):
    line = line.split("#", 1)[0].strip()
    if "==" in line:
        name, ver = line.split("==", 1)
        pins[norm(name)] = ver.strip()

report = json.load(open(sys.argv[1], encoding="utf-8"))
unpinned, mismatch, ok = [], [], 0
for item in report["install"]:
    meta = item["metadata"]
    name, ver = norm(meta["name"]), meta["version"]
    url = item.get("download_info", {}).get("url", "")
    wheel = url.rsplit("/", 1)[-1]
    if name not in pins:
        unpinned.append(f"{name}=={ver}")
        print(f"UNPINNED  {name}=={ver}  {wheel}")
    elif pins[name] != ver:
        mismatch.append(f"{name} {ver} != pin {pins[name]}")
        print(f"MISMATCH  {name}=={ver} (pin {pins[name]})  {wheel}")
    else:
        ok += 1
        print(f"ok        {name}=={ver}  {wheel}")
print(f"SUMMARY resolved={len(report['install'])} at_pin={ok} unpinned={len(unpinned)} mismatched={len(mismatch)} "
      f"pins_in_file={len(pins)} pins_not_used={sorted(set(pins) - {norm(i['metadata']['name']) for i in report['install']})}")
for item in report["install"]:
    if norm(item["metadata"]["name"]) == "colorama":
        print("colorama required by:", "see requires_dist of qrcode/click below")
for item in report["install"]:
    n = norm(item["metadata"]["name"])
    for req in item["metadata"].get("requires_dist", []) or []:
        if req.lower().startswith("colorama"):
            print(f"  {n} requires: {req}")
