#!/bin/bash
# CL2-IF IF-13: capture what volume-init did and how the r2c volumes look (run from Git Bash on the host).
# usage: bash if13_capture_volumes.sh <phase-label>
export MSYS_NO_PATHCONV=1
echo "# phase: $1  ($(date -u +%FT%TZ))"
echo "# docker logs ckam-r2c-volume-init-1"
docker logs ckam-r2c-volume-init-1 2>&1
echo "# volume-init exit code: $(docker inspect ckam-r2c-volume-init-1 --format '{{.State.ExitCode}}')"
echo "# volume-init HostConfig"
docker inspect ckam-r2c-volume-init-1 --format 'User={{.Config.User}} CapDrop={{.HostConfig.CapDrop}} CapAdd={{.HostConfig.CapAdd}} SecurityOpt={{.HostConfig.SecurityOpt}} NetworkMode={{.HostConfig.NetworkMode}}'
echo "# volume labels"
docker volume inspect ckam-r2c_uploads ckam-r2c_logs --format '{{.Name}} created={{.CreatedAt}} labels={{.Labels}}'
echo "# volumes now (numeric owners, alpine:latest listing as root, read-only mounts)"
docker run --rm --network none -v ckam-r2c_uploads:/data/uploads:ro -v ckam-r2c_logs:/data/logs:ro alpine:latest ls -lanR /data
echo "# api container state"
docker inspect ckam-r2c-api-1 --format 'State={{.State.Status}} Restarts={{.RestartCount}} User={{.Config.User}} CapDrop={{.HostConfig.CapDrop}} CapAdd={{.HostConfig.CapAdd}} SecurityOpt={{.HostConfig.SecurityOpt}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} Privileged={{.HostConfig.Privileged}}'
echo "# api log tail"
docker logs ckam-r2c-api-1 2>&1 | tail -15
