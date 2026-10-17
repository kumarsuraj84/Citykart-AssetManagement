"""List Requires-Dist lines with a Windows marker from every wheel in a folder."""
import glob
import sys
import zipfile

for w in sorted(glob.glob(sys.argv[1] + "/*.whl")):
    z = zipfile.ZipFile(w)
    meta = [n for n in z.namelist() if n.endswith(".dist-info/METADATA")][0]
    for line in z.read(meta).decode("utf-8", "replace").splitlines():
        if line.startswith("Requires-Dist") and ("win32" in line or "Windows" in line):
            print(w.rsplit("/", 1)[-1], "->", line)
