#!/bin/bash
# MANIFEST.sha256.txt: SHA-256 of the zip and of every file in the release folder, sorted by path (C locale),
# GNU sha256sum format ("<hash>  <path>", paths relative to release-packages\), checkable with `sha256sum -c`.
set -e
R="/d/ANKUR AI PROJECTS/Asset Management/release-packages"
S="/c/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/rel"
cd "$R"
{ find ckam-security-release-eed3de1 -type f -printf '%p\0'; printf 'ckam-security-release-eed3de1.zip\0'; } \
  | LC_ALL=C sort -z | xargs -0 sha256sum -b \
  | awk '{h=$1; sub(/^[0-9a-f]+ \*/, ""); print h "  " $0}' > "$S/MANIFEST.sha256.txt"
wc -l < "$S/MANIFEST.sha256.txt"
grep -n 'zip$' "$S/MANIFEST.sha256.txt"
cp "$S/MANIFEST.sha256.txt" "$R/MANIFEST.sha256.txt"
sha256sum -c --quiet MANIFEST.sha256.txt && echo MANIFEST_CHECK_OK
sha256sum MANIFEST.sha256.txt
