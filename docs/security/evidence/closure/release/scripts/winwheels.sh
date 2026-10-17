#!/bin/sh
# Does every pinned runtime version have a Windows (win_amd64, CPython 3.13) wheel or a pure-Python wheel?
# pip evaluates environment markers against THIS (Linux) interpreter even with --platform, so the check is done
# per pin with --no-deps; uvloop is skipped because uvicorn[standard] only wants it when sys_platform != 'win32'.
set -u
grep '==' /pkg/constraints.txt | grep -v '^#' | grep -iv '^uvloop==' > /tmp/pins.txt
echo "pins checked: $(wc -l < /tmp/pins.txt) (uvloop skipped: not installed on Windows)"
pip install --disable-pip-version-check --root-user-action=ignore --dry-run --no-deps --only-binary=:all: \
  --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 --abi abi3 --abi none \
  --target /tmp/wintarget -r /tmp/pins.txt > /tmp/win.txt 2>&1
echo "windows wheel dry-run exit: $?"
grep -E "^Would install|ERROR" /tmp/win.txt || tail -5 /tmp/win.txt
echo "== Windows-only requirements declared by the pinned wheels (Requires-Dist lines with a Windows marker)"
pip download --disable-pip-version-check -q --no-deps --only-binary=:all: -d /tmp/m -r /tmp/pins.txt > /tmp/dl.txt 2>&1
echo "download exit: $?"
python -I /tools/winmarkers.py /tmp/m
