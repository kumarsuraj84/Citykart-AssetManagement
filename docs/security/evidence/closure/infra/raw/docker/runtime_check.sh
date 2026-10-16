#!/bin/sh
# IF-13 proof (d): the runtime image has no test tooling and no tests folder, and runs as uid 10001.
echo "id: $(id)"
echo "/app: $(ls /app | tr '\n' ' ')"
if [ -d /app/tests ]; then echo "tests dir: PRESENT"; else echo "tests dir: absent"; fi
for m in pytest _pytest coverage pytest_asyncio pytest_cov httpx; do
  if python -c "import $m" 2>/dev/null; then echo "module $m: PRESENT"; else echo "module $m: absent"; fi
done
if command -v pytest >/dev/null 2>&1; then echo "pytest command: PRESENT"; else echo "pytest command: absent"; fi
python -c "import fastapi, uvicorn, sqlalchemy, asyncpg, alembic; print('runtime modules import fine')"
