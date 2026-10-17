"""GT: copy the extracted release layout into the throw-away volume ckam-gate-root (mounted at /srv/ckam) and
plant the FAKE canaries the IF-01 attack list aims at. Production layout:
/srv/ckam/releases/<sha>/{backend,frontend-dist}, /srv/ckam/shared/{.env,nas.pw,run_ckam_web.ps1}, /srv/ckam/logs/app.
Nothing here is a real secret."""
import os, shutil
SRC, DST = "/src", "/srv/ckam"
for name in os.listdir(SRC):
    s, d = os.path.join(SRC, name), os.path.join(DST, name)
    if os.path.isdir(s):
        shutil.copytree(s, d, dirs_exist_ok=True)
    else:
        shutil.copy2(s, d)
for sha in ("ccae7b2",):
    dist = f"{DST}/releases/{sha}/frontend-dist"
    # sibling folder with the same prefix as assets/ (classic startswith() containment bug)
    os.makedirs(f"{dist}/assets-evil", exist_ok=True)
    open(f"{dist}/assets-evil/x", "w").write("FAKE-CANARY-SIBLING\n")
    # symlinks inside the served folder that lead OUTSIDE it
    for link, target in (("link-env.txt", f"{DST}/shared/.env"), ("linkdir", f"{DST}/shared")):
        p = f"{dist}/assets/{link}"
        if os.path.lexists(p):
            os.remove(p)
        os.symlink(target, p)
os.makedirs(f"{DST}/logs/app", exist_ok=True)
os.makedirs(f"{DST}/uploads", exist_ok=True)
for root, dirs, files in os.walk(DST):
    for n in dirs + files:
        os.lchown(os.path.join(root, n), 10001, 10001)
os.chown(DST, 10001, 10001)
for root, dirs, files in os.walk(f"{DST}/shared"):
    print("shared:", sorted(files))
print("links:", [(l, os.readlink(f"{DST}/releases/ccae7b2/frontend-dist/assets/{l}")) for l in ("link-env.txt", "linkdir")])
print("releases:", sorted(os.listdir(f"{DST}/releases")))
