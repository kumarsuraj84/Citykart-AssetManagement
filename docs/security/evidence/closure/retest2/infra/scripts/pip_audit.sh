#!/bin/bash
# CL2-IF item 7: pip-audit of the pinned backend set (backend/constraints.txt) in a throw-away python:3.13-slim
# container (image already local). Network is used only for PyPI (installing pip-audit) and the advisory lookup.
# --no-deps --disable-pip: audit exactly the pinned versions listed, without resolving/installing them.
export MSYS_NO_PATHCONV=1
docker run --rm -v "$(pwd)/backend:/src:ro" python:3.13-slim sh -c \
  "pip install -q --disable-pip-version-check --root-user-action=ignore pip-audit >/dev/null 2>&1 && pip-audit --version && pip-audit -r /src/constraints.txt --no-deps --disable-pip --format json 2>/dev/null; echo; pip-audit -r /src/constraints.txt --no-deps --disable-pip 2>&1 | tail -15"
