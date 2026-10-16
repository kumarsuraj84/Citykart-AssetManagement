#!/bin/bash
# List a pair of volumes (uploads, logs) with numeric owners and the newest log lines' size (read-only mounts).
# usage: bash if13_list_volume.sh <uploads-volume> <logs-volume>
export MSYS_NO_PATHCONV=1
echo "# $(date -u +%FT%TZ) uploads=$1 logs=$2"
docker run --rm --network none -v "$1":/data/uploads:ro -v "$2":/data/logs:ro alpine:latest sh -c 'ls -lanR /data; echo "# log line counts"; wc -l /data/logs/*.jsonl'
