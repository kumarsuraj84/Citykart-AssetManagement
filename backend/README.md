# CKAM Backend

FastAPI + SQLAlchemy (async) + PostgreSQL. See [../docs/deployment.md](../docs/deployment.md) for running the full stack.

## Running the test suite

**Never run pytest with `DATABASE_URL` pointed at the `ckam` database that `docker-compose.yml`'s `api`
service uses.** `backend/tests/conftest.py` truncates every application table before every test, and
`ckam` is the one persistent database the dev/demo stack actually runs on.

Always run tests against the dedicated `ckam_test` database instead. `docker-compose.yml` creates it
automatically alongside `ckam` on the same `db` service (via `ops/init-test-db.sql`, on first init of a
fresh `db_data` volume — see that file for the one-off manual command if your volume predates it).

The test suite does **not** create tables itself (it only truncates them), so `ckam_test` needs the schema.
Bring it to the current migration head first — once after creating it, and again after every `git pull`
that adds a migration (it is a no-op when already up to date):

```bash
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:${POSTGRES_PASSWORD:-ckam_dev_pw}@db:5432/ckam_test api alembic upgrade head
```

Then run the suite:

```bash
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:${POSTGRES_PASSWORD:-ckam_dev_pw}@db:5432/ckam_test api python -m pytest -q
```

Note that the `api` container runs the code it was **built** with. To test uncommitted local changes without
rebuilding, run a one-off container with your checkout mounted over `/app` (still against `ckam_test`):

```bash
docker compose run --rm --no-deps -T -v "$(pwd)/backend:/app" \
  -e DATABASE_URL=postgresql+asyncpg://ckam:${POSTGRES_PASSWORD:-ckam_dev_pw}@db:5432/ckam_test \
  api python -m pytest -q
```

As a backstop, `conftest.py` itself refuses to run (raising `UnsafeTestDatabaseError` before touching any
table) unless `DATABASE_URL`'s database name ends in `_test`, or `CKAM_ALLOW_TEST_TRUNCATE=1` is set
explicitly for a test database named differently:

```bash
# only if your test database can't be named "*_test" for some reason
docker compose exec -T -e DATABASE_URL=... -e CKAM_ALLOW_TEST_TRUNCATE=1 api python -m pytest -q
```

Running locally (outside Docker) works the same way — export `DATABASE_URL` before invoking `pytest`,
pointed at a `*_test` database reachable from your machine.
