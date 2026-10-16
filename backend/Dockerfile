# Dev/UAT image of the CKAM API (production does not use Docker: it runs uvicorn from a venv on Windows, see
# ops/windows/). Security IF-13: two targets, and NEITHER runs the application as root.
#
#   runtime  (the default when no --target is given): runtime packages only (pinned by constraints.txt, IF-11),
#            no pytest / coverage / httpx, no tests/ folder. Can run with a read-only root filesystem
#            (writable: /data/uploads, /data/logs, /tmp).
#   dev      (docker-compose.yml uses this): runtime + the [dev] extras + tests/, so
#            `docker compose exec api python -m pytest` keeps working (CLAUDE.md rule 4).
#
# The process runs as user `ckam` (uid/gid 10001). It can write only /data/uploads, /data/logs and /tmp; /app
# stays root-owned and read-only for it. Named volumes created by older root images are handed to uid 10001 by
# the one-shot `volume-init` service in docker-compose.yml before the API starts.

FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp
WORKDIR /app
RUN groupadd --system --gid 10001 ckam \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin ckam \
 && mkdir -p /data/uploads /data/logs \
 && chown 10001:10001 /data/uploads /data/logs
COPY pyproject.toml constraints.txt ./

FROM base AS dev
RUN pip install -c constraints.txt -e ".[dev]"
COPY app ./app
COPY scripts ./scripts
COPY tests ./tests
COPY alembic.ini ./
# S8: the release shown in logs and the diagnostics bundle (docker compose build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD)).
ARG GIT_COMMIT=
# pytest's cache folder would be written into /app, which the non-root user cannot (and need not) write.
ENV GIT_COMMIT=${GIT_COMMIT} \
    PYTEST_ADDOPTS="-p no:cacheprovider"
EXPOSE 8000
USER 10001:10001
# Security N2: uvicorn must not rewrite the client address from X-Forwarded-For (the app does its own trusted-proxy check).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]

FROM base AS runtime
RUN pip install -c constraints.txt -e .
COPY app ./app
COPY scripts ./scripts
COPY alembic.ini ./
ARG GIT_COMMIT=
ENV GIT_COMMIT=${GIT_COMMIT}
EXPOSE 8000
USER 10001:10001
# Security N2: uvicorn must not rewrite the client address from X-Forwarded-For (the app does its own trusted-proxy check).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
