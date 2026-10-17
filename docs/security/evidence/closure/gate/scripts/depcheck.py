"""GT: compare the runtime image's installed packages with the package's constraints.txt (IF-11 pins)."""
import subprocess, sys
pins = {}
for line in open("/pkg/constraints.txt", encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "==" in line:
        n, v = line.split("==", 1)
        pins[n.lower().replace("_", "-")] = v.split(";")[0].strip()
out = subprocess.run([sys.executable, "-m", "pip", "freeze", "--exclude-editable"], capture_output=True, text=True).stdout
inst = {}
for line in out.splitlines():
    if "==" in line:
        n, v = line.split("==", 1)
        inst[n.lower().replace("_", "-")] = v.strip()
print("python", sys.version.split()[0], "pins", len(pins), "installed", len(inst))
diff = 0
for n, v in sorted(pins.items()):
    if inst.get(n) != v:
        diff += 1
        print("DIFF", n, "pinned", v, "installed", inst.get(n))
for n in sorted(set(inst) - set(pins)):
    print("EXTRA", n, inst[n])
print("pin mismatches:", diff)
