#!/bin/bash
# Content hash = SHA-256 of "<sha256>  <path relative to the folder>\n" for every file, sorted by path (C order).
# usage: contenthash.sh <folder> [file to save the hash list in]
set -euo pipefail
cd "$1"
find . -type f -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum -b | awk '{h=$1; sub(/^[0-9a-f]+ \*/, ""); print h "  " $0}' > /tmp/ckam_content_list.txt
if [ $# -ge 2 ]; then cp /tmp/ckam_content_list.txt "$2"; fi
echo "$(wc -l < /tmp/ckam_content_list.txt) files, content hash $(sha256sum < /tmp/ckam_content_list.txt | cut -d' ' -f1)  ($1)"
