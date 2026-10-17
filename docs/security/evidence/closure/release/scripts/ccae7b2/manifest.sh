#!/bin/bash
# MANIFEST.sha256.txt for one release: SHA-256 of the zip and of every file in the release folder, sorted by path
# (C locale), GNU sha256sum format ("<hash>  <path>", paths relative to release-packages\), checkable with
# `sha256sum -c`. The previous release's manifest is kept as MANIFEST.<old>.sha256.txt (copied before overwriting).
# usage: manifest.sh <release name> [<old release short sha>]
set -euo pipefail
NAME="$1"
R="/d/ANKUR AI PROJECTS/Asset Management/release-packages"
S="/c/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/rel2"
cd "$R"
if [ $# -ge 2 ] && [ -f MANIFEST.sha256.txt ] && [ ! -f "MANIFEST.$2.sha256.txt" ]; then
  grep -q "ckam-security-release-$2.zip" MANIFEST.sha256.txt && cp -p MANIFEST.sha256.txt "MANIFEST.$2.sha256.txt" && echo "kept old manifest as MANIFEST.$2.sha256.txt"
fi
{ find "$NAME" -type f -printf '%p\0'; printf '%s.zip\0' "$NAME"; } \
  | LC_ALL=C sort -z | xargs -0 sha256sum -b \
  | awk '{h=$1; sub(/^[0-9a-f]+ \*/, ""); print h "  " $0}' > "$S/MANIFEST.sha256.txt"
echo "lines: $(wc -l < "$S/MANIFEST.sha256.txt")"
grep -n 'zip$' "$S/MANIFEST.sha256.txt"
cp "$S/MANIFEST.sha256.txt" "$R/MANIFEST.sha256.txt"
sha256sum -c --quiet MANIFEST.sha256.txt && echo "MANIFEST_CHECK_OK (new)"
if [ $# -ge 2 ] && [ -f "MANIFEST.$2.sha256.txt" ]; then sha256sum -c --quiet "MANIFEST.$2.sha256.txt" && echo "MANIFEST_CHECK_OK (old $2: folder and zip unchanged)"; fi
sha256sum MANIFEST.sha256.txt
