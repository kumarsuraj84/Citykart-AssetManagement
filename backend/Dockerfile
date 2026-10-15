FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]"
COPY app ./app
COPY scripts ./scripts
COPY tests ./tests
COPY alembic.ini ./
# S8: the release shown in logs and the diagnostics bundle (docker compose build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD)).
ARG GIT_COMMIT=
ENV GIT_COMMIT=${GIT_COMMIT}
EXPOSE 8000
# Security N2: uvicorn must not rewrite the client address from X-Forwarded-For (the app does its own trusted-proxy check).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
