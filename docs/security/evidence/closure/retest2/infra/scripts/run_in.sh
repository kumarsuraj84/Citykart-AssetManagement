#!/bin/bash
# Helper: run a POSIX sh script inside a container as its default user, write stdout+stderr to a file.
# usage: bash run_in.sh <container> <script-on-host> <output-file> [extra docker exec args...]
c="$1"; s="$2"; o="$3"; shift 3
export MSYS_NO_PATHCONV=1
{ echo "# container: $c  script: $(basename "$s")  at $(date -u +%FT%TZ)"; docker exec -i "$@" "$c" sh -s < "$s"; echo "# exit: $?"; } > "$o" 2>&1
cat "$o"
