#!/bin/bash
# CL2-IF IF-13: the `runtime` target (docker build --target runtime -t ckam-r2c-rt backend).
# (a) default `docker run` (no hardening flags): who runs it and is any test tooling inside?
# (b) hardened run: --read-only + tmpfs /tmp + cap-drop ALL + no-new-privileges + throw-away volumes.
# (c) image metadata (User, Cmd, Env KEY names only) and layer history keys.
export MSYS_NO_PATHCONV=1
S="$(dirname "$0")/if13_incontainer.sh"
echo "### (c) image config"
docker image inspect ckam-r2c-rt --format 'User={{.Config.User}} WorkingDir={{.Config.WorkingDir}} Cmd={{json .Config.Cmd}} Entrypoint={{json .Config.Entrypoint}}'
docker image inspect ckam-r2c-rt --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -E 's/=.*/=<value hidden>/'
echo "### (a) default run, no extra flags"
docker run --rm -i --network none --entrypoint sh ckam-r2c-rt -s < "$S"
echo "### (b) hardened run: --read-only --tmpfs /tmp, cap-drop ALL, no-new-privileges, fresh anonymous volumes for /data/*"
docker run --rm -i --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m --cap-drop ALL \
  --security-opt no-new-privileges:true -v /data/uploads -v /data/logs --entrypoint sh ckam-r2c-rt -s < "$S"
echo "### (d) pip list of the runtime image: test / dev packages?"
docker run --rm --network none ckam-r2c-rt pip list --format=freeze 2>/dev/null | grep -iE '^(pytest|coverage|httpx|pytest-|ruff|mypy|black|faker|respx)' || echo "no pytest/coverage/httpx/ruff/mypy/black/faker/respx packages installed"
docker run --rm --network none ckam-r2c-rt pip list --format=freeze 2>/dev/null | wc -l | sed 's/^/installed distributions: /'
