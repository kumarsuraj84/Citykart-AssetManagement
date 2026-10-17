#!/bin/sh
# Throw-away python:3.13-slim container: /c = constraints (read-only), /w = this folder (outputs). Package index only.
set -u
PIPI="python -m pip install --disable-pip-version-check --no-cache-dir --root-user-action=ignore"
rm -f /w/report_*.json /w/win_pins*.txt
WINOPTS="--only-binary=:all: --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 --abi abi3 --abi none"
echo "== python / pip"; python -V; python -m pip -V
QR=$(grep -E '^qrcode==' /c/constraints.new.txt | cut -d= -f3)
echo "== qrcode pin: $QR"

echo; echo "== 1. Linux: pip install --dry-run -c constraints.txt (NEW) qrcode==$QR"
$PIPI --dry-run --ignore-installed -c /c/constraints.new.txt "qrcode==$QR" > /tmp/o1 2>&1; echo "exit: $?"; grep -E 'Would install|ERROR' /tmp/o1

echo; echo "== 2. Windows wheels: qrcode==$QR plus its win32-only requirement 'colorama' (unversioned, as qrcode asks)"
echo "   (pip evaluates markers for THIS Linux interpreter even with --platform, so colorama is named explicitly)"
echo "-- with the NEW constraints:"
$PIPI --dry-run --ignore-installed $WINOPTS --target /tmp/t1 -c /c/constraints.new.txt "qrcode==$QR" colorama > /tmp/o2 2>&1; echo "exit: $?"; grep -E 'Would install|ERROR' /tmp/o2
echo "-- with the COMMITTED constraints (HEAD, no colorama line):"
$PIPI --dry-run --ignore-installed $WINOPTS --target /tmp/t2 -c /w/constraints.HEAD.txt "qrcode==$QR" colorama > /tmp/o3 2>&1; echo "exit: $?"; grep -E 'Would install|ERROR' /tmp/o3

echo; echo "== 3. colorama 0.4.6 universal wheel for win_amd64 / cp313 (pip download --no-deps --only-binary=:all:)"
rm -rf /tmp/dl && mkdir -p /tmp/dl
python -m pip --disable-pip-version-check --no-cache-dir download -q --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.13 colorama==0.4.6 -d /tmp/dl; echo "exit: $?"
ls -l /tmp/dl
sha256sum /tmp/dl/*

echo; echo "== 4. Linux full backend runtime deps (pyproject dependencies) with the NEW constraints (also gives the metadata)"
$PIPI --dry-run --ignore-installed -c /c/constraints.new.txt -r /w/requirements.pyproject.txt --report /w/report_linux_new.json -q; echo "exit: $?"
python -I /w/compare.py /w/report_linux_new.json /c/constraints.new.txt | grep -E 'UNPINNED|MISMATCH|SUMMARY|requires:'

echo; echo "== 5. Windows closure (markers evaluated for win32 / CPython 3.13) against the NEW constraints"
python -I /w/wincheck.py /w/report_linux_new.json /w/requirements.pyproject.txt /c/constraints.new.txt /tmp/dl/colorama-0.4.6-py2.py3-none-any.whl
cp /w/win_pins.txt /w/win_pins_new.txt

echo; echo "== 6. The same against the COMMITTED constraints (HEAD, before this change; the colorama version shown is only the"
echo "      downloaded wheel's - without a pin pip takes the newest, see step 2)"
python -I /w/wincheck.py /w/report_linux_new.json /w/requirements.pyproject.txt /w/constraints.HEAD.txt /tmp/dl/colorama-0.4.6-py2.py3-none-any.whl | grep -E 'closure|only on|UNPINNED|MISMATCH|WINDOWS RESULT'

echo; echo "== 7. Every package of the Windows closure (NEW pins) has a win_amd64/cp313 or universal wheel (--no-deps dry run)"
$PIPI --dry-run --ignore-installed --no-deps $WINOPTS --target /tmp/t3 -r /w/win_pins_new.txt > /tmp/o7 2>&1; echo "exit: $?"; grep -E 'Would install|ERROR' /tmp/o7 | fold -w 200

echo; echo "== 8. Pinned versions unchanged: diff of the pin lines HEAD -> NEW"
grep -E '^[A-Za-z]' /w/constraints.HEAD.txt > /tmp/a; grep -E '^[A-Za-z]' /c/constraints.new.txt > /tmp/b
diff /tmp/a /tmp/b; echo "pins HEAD: $(wc -l < /tmp/a)  pins NEW: $(wc -l < /tmp/b)"
