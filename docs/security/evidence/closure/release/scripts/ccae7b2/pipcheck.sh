#!/bin/sh
# Runs inside a throw-away python:3.13-slim container. /pkg = the package's backend folder (read-only).
set -u
cp -r /pkg /tmp/backend
echo "== python: $(python --version) / $(pip --version)"
echo "== compileall (app + scripts)"
python -m compileall -q /tmp/backend/app /tmp/backend/scripts && echo "COMPILE_OK" || echo "COMPILE_FAIL"
rm -rf /tmp/backend
cp -r /pkg /tmp/backend
echo "== pip install --dry-run -c constraints.txt -e backend"
pip install --disable-pip-version-check --root-user-action=ignore --dry-run -c /tmp/backend/constraints.txt -e /tmp/backend > /tmp/dry.txt 2>&1
echo "dry-run exit: $?"
grep -E "^Would install|ERROR|error:" /tmp/dry.txt || tail -5 /tmp/dry.txt
echo "== real install in this throw-away container (the deploy command): pip install -c constraints.txt -e backend"
python -m venv /tmp/venv
/tmp/venv/bin/python -m pip install --disable-pip-version-check -q -c /tmp/backend/constraints.txt -e /tmp/backend > /tmp/real.txt 2>&1
echo "install exit: $?"
tail -3 /tmp/real.txt
echo "== installed versions that differ from constraints.txt (expect none except pip/setuptools/project)"
/tmp/venv/bin/python -m pip freeze --exclude-editable > /tmp/freeze.txt
grep -v '^#' /tmp/backend/constraints.txt | grep '==' | tr 'A-Z_' 'a-z-' | sort > /tmp/want.txt
tr 'A-Z_' 'a-z-' < /tmp/freeze.txt | sort > /tmp/have.txt
echo "constraints pins: $(wc -l < /tmp/want.txt); installed (non-editable): $(wc -l < /tmp/have.txt)"
echo "-- pinned but not installed with that exact version:"; comm -23 /tmp/want.txt /tmp/have.txt
echo "-- installed but not pinned:"; comm -13 /tmp/want.txt /tmp/have.txt
echo "== import check + alembic heads from the installed release (no database needed)"
cd /tmp/backend
/tmp/venv/bin/python -I -c "import importlib, app, app.alembic; print('app package at', app.__file__)"
/tmp/venv/bin/python -m alembic heads 2>&1 | tail -2
echo "== release id as the app reports it from backend/VERSION (APP_VERSION / GIT_COMMIT unset; no database contacted)"
env -u APP_VERSION -u GIT_COMMIT ENVIRONMENT_NAME=development /tmp/venv/bin/python -c "from app.observability.system import app_version; print('app_version() =', app_version())" 2>&1 | tail -2
