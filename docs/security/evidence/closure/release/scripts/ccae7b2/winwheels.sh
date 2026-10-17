#!/bin/sh
# Windows check of the 44 pins (runs in a throw-away python:3.13-slim container; /pkg = the package's backend, read-only).
# 1. Every pinned version (except uvloop, which uvicorn[standard] only wants when sys_platform != 'win32') has a
#    win_amd64 CPython 3.13 wheel or a pure-Python wheel. pip evaluates markers against THIS Linux interpreter even
#    with --platform, so the check is per pin with --no-deps.
# 2. Windows-only requirements declared by the pinned wheels (Requires-Dist lines with a Windows marker).
# 3. A full Windows resolution of the project with the constraints (uv pip compile --python-platform windows), which
#    evaluates the markers as Windows: every resolved package must be pinned in constraints.txt.
set -u
grep '==' /pkg/constraints.txt | grep -v '^#' | grep -iv '^uvloop==' > /tmp/pins.txt
echo "pins in constraints.txt: $(grep '==' /pkg/constraints.txt | grep -vc '^#'); checked for Windows wheels: $(wc -l < /tmp/pins.txt) (uvloop skipped: not installed on Windows)"
grep -i '^colorama==' /tmp/pins.txt
pip install --disable-pip-version-check --root-user-action=ignore --dry-run --no-deps --only-binary=:all: \
  --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 --abi abi3 --abi none \
  --target /tmp/wintarget -r /tmp/pins.txt > /tmp/win.txt 2>&1
echo "windows wheel dry-run exit: $?"
grep -E "^Would install|ERROR" /tmp/win.txt || tail -5 /tmp/win.txt
echo "== Windows-only requirements declared by the pinned wheels"
pip download --disable-pip-version-check -q --no-deps --only-binary=:all: -d /tmp/m -r /tmp/pins.txt > /tmp/dl.txt 2>&1
echo "download exit: $?"
python -I /tools/winmarkers.py /tmp/m
echo "== full Windows resolution: uv pip compile --python-platform x86_64-pc-windows-msvc --python-version 3.13"
pip install --disable-pip-version-check --root-user-action=ignore -q uv > /tmp/uvinstall.txt 2>&1
echo "uv: $(uv --version 2>&1)"
cp -r /pkg /tmp/backend
uv pip compile --quiet --no-header --no-annotate --python-platform x86_64-pc-windows-msvc --python-version 3.13 \
  -c /tmp/backend/constraints.txt /tmp/backend/pyproject.toml -o /tmp/win_resolved.txt > /tmp/uv.txt 2>&1
echo "uv compile exit: $?"; tail -3 /tmp/uv.txt
grep '==' /tmp/win_resolved.txt | tr 'A-Z_' 'a-z-' | sort > /tmp/winres.txt
grep '==' /pkg/constraints.txt | grep -v '^#' | tr 'A-Z_' 'a-z-' | sort > /tmp/want.txt
echo "resolved for Windows: $(wc -l < /tmp/winres.txt) packages"
echo "-- resolved for Windows but not pinned with that exact version (must be empty):"; comm -23 /tmp/winres.txt /tmp/want.txt
echo "-- pinned but not used on Windows:"; comm -13 /tmp/winres.txt /tmp/want.txt
