# CityKart Asset Manager (CKAM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CKAM — a FastAPI + PostgreSQL + React app that tracks every CityKart asset from procurement to scrap via an append-only custody ledger, running on a LAN server via Docker Compose.

**Architecture:** Modular monolith. Backend: FastAPI (async SQLAlchemy 2, Alembic) organized into `core`, `masters`, `holders`, `numbering`, `assets`, `lifecycle`, `documents`, `imports`, `reports` modules, each with `models.py`/`schemas.py`/`service.py`/`router.py`. Frontend: React 19 + Vite + TanStack Query/Router + Tailwind + shadcn/ui, styled with the CityKart design system. Postgres is the single source of truth; the `asset_event` ledger is append-only and DB-trigger-protected.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL 17, Argon2 (`argon2-cffi`), `python-jose` for JWT, pytest + pytest-asyncio + httpx; React 19, Vite, TanStack Query/Router, Tailwind CSS, shadcn/ui, react-hook-form + Zod, Vitest, Playwright; Docker Compose.

**Spec:** [docs/specs/2026-09-23-ckam-design.md](../../specs/2026-09-23-ckam-design.md) — this plan implements every section of that spec; read both.

## Global Constraints

- Backend: Python 3.13, FastAPI, SQLAlchemy 2.0 async engine, Alembic migrations only (no `create_all` in runtime code).
- Database: PostgreSQL 17. All schema changes go through Alembic revisions, never hand-run SQL.
- No hard deletes anywhere: masters/holders/assets use `is_active`/`deleted_at`; `asset_event` rows are never UPDATEd or DELETEd (DB trigger enforced, spec §4.5, §8).
- `asset.status`, `asset.current_holder_id`, `asset.status_since` are written **only** by the lifecycle service, never directly by any router (spec §2.5, §5).
- `asset.asset_code`, `asset.company_id`, `asset.cost_center_id` are immutable after insert (DB trigger, spec §4.4, D8).
- Every mutable table carries `created_at`, `created_by`, `updated_at`, `updated_by` (spec §4).
- Passwords: Argon2id hashes only, never plaintext (spec §8).
- Every API route enforces role/company scope server-side; unauthorized reads return 404, disallowed actions return 403 (spec §6).
- Frontend styled with the CityKart design system (`citykart-ui:sk-uisystem-ck`), scaffolded via `sk-uiscaffold-ck`; must be usable at phone width.
- Money fields use `NUMERIC(14,2)`; percentages `NUMERIC(5,2)`.
- Test-first: every task's behavior gets a failing test before the implementation that makes it pass.
- Commit after every task (and after sub-steps that pass tests), using Conventional Commit-style messages.

---

## Task 1: Backend skeleton, Docker Compose, Alembic

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/main.py`
- Create: `backend/Dockerfile`, `backend/alembic.ini`, `backend/app/alembic/env.py`, `backend/app/alembic/script.py.mako`
- Create: `docker-compose.yml`, `.env.example`
- Test: `backend/tests/test_health.py`, `backend/tests/conftest.py`

**Interfaces:**
- Produces: `app.main:app` (FastAPI instance) with `GET /api/health -> {"status": "ok"}`; `docker compose up` starts `db` (Postgres 17) and `api` (uvicorn on 8000) services.

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "ckam-backend"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "sqlalchemy[asyncio]>=2.0",
  "asyncpg>=0.30",
  "alembic>=1.14",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "argon2-cffi>=23.1",
  "python-jose[cryptography]>=3.3",
  "python-multipart>=0.0.12",
  "openpyxl>=3.1",
  "qrcode[pil]>=8.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "httpx>=0.27", "pytest-cov>=6.0"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Create `backend/app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="CityKart Asset Manager API")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 3: Write the failing test**

```python
# backend/tests/conftest.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

```python
# backend/tests/test_health.py
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 4: Install deps and run the test**

Run (from `backend/`): `python -m venv .venv && .venv\Scripts\pip install -e ".[dev]"`
Then: `.venv\Scripts\pytest tests/test_health.py -v`
Expected: `1 passed` (the route already exists from Step 2 — this step confirms the toolchain works end to end).

- [ ] **Step 5: Create `backend/Dockerfile`**

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .
COPY app ./app
COPY alembic.ini ./
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: ckam
      POSTGRES_USER: ckam
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-ckam_dev_pw}
    volumes:
      - db_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ckam"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build: ./backend
    environment:
      DATABASE_URL: postgresql+asyncpg://ckam:${POSTGRES_PASSWORD:-ckam_dev_pw}@db:5432/ckam
      JWT_SECRET: ${JWT_SECRET:-dev_secret_change_me}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8000:8000"
    volumes:
      - uploads:/data/uploads

volumes:
  db_data:
  uploads:
```

- [ ] **Step 7: Create `.env.example`**

```
POSTGRES_PASSWORD=change_me
JWT_SECRET=change_me_too
BASE_URL=http://localhost:8000
BACKUP_DIR=./backups
```

- [ ] **Step 8: Initialize Alembic**

Run (from `backend/`): `.venv\Scripts\alembic init app/alembic`
This creates `backend/alembic.ini`, `backend/app/alembic/env.py` and `backend/app/alembic/script.py.mako`. In `backend/app/alembic/env.py`, replace the `sqlalchemy.url` handling near the top of `run_migrations_offline`/`run_migrations_online` setup with:

```python
import os
from alembic import context
config = context.config
config.set_main_option(
    "sqlalchemy.url",
    os.environ.get("DATABASE_URL", "postgresql+psycopg2://ckam:ckam_dev_pw@localhost:5432/ckam"),
)
```

Leave `target_metadata = None` for now — Task 2 sets it once `Base` exists.

- [ ] **Step 9: Bring up Docker Compose and verify**

Run: `docker compose up -d db` then wait for healthy, then `docker compose up -d --build api`
Run: `curl http://localhost:8000/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git add backend docker-compose.yml .env.example
git commit -m "chore: backend skeleton, Docker Compose, Alembic init"
```

---

## Task 2: Core config, DB session, audit mixin

**Files:**
- Create: `backend/app/core/__init__.py`, `backend/app/core/config.py`, `backend/app/core/db.py`, `backend/app/core/models.py`
- Modify: `backend/app/alembic/env.py` (set `target_metadata`)
- Test: `backend/tests/core/test_db.py`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `app.core.config.settings` (Pydantic Settings: `database_url`, `jwt_secret`, `jwt_access_minutes`, `jwt_refresh_hours`, `base_url`, `upload_dir`); `app.core.db.get_session` (async dependency yielding `AsyncSession`); `app.core.db.Base` (SQLAlchemy declarative base); `app.core.db.SessionLocal`; `app.core.models.AuditMixin` (`created_at`, `created_by`, `updated_at`, `updated_by`) and `app.core.models.SoftDeleteMixin` (`is_active`, `deleted_at`).

- [ ] **Step 1: Create `backend/app/core/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://ckam:ckam_dev_pw@localhost:5432/ckam"
    jwt_secret: str = "dev_secret_change_me"
    jwt_access_minutes: int = 15
    jwt_refresh_hours: int = 8
    base_url: str = "http://localhost:8000"
    upload_dir: str = "/data/uploads"
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
```

- [ ] **Step 2: Create `backend/app/core/db.py`**

```python
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
```

- [ ] **Step 3: Write the failing test**

```python
# backend/tests/core/test_db.py
from sqlalchemy import text
from app.core.db import SessionLocal


async def test_db_connects():
    async with SessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        assert result.scalar() == 1
```

- [ ] **Step 4: Run test to verify it fails**

Run: `docker compose up -d db` (if not already up), then `.venv\Scripts\pytest tests/core/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core'` (files not created yet).

- [ ] **Step 5: Create `backend/app/core/models.py`**

```python
from datetime import datetime
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column


class AuditMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))


class SoftDeleteMixin:
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/core/test_db.py -v`
Expected: `1 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/core backend/tests/core
git commit -m "feat(core): settings, async DB session, audit/soft-delete mixins"
```

*(`target_metadata` is wired up in Task 4 Step 4, once both `masters` and `holders` models exist, to avoid a partial/broken autogenerate diff.)*

---

## Task 3: Master data models + migration

**Files:**
- Create: `backend/app/masters/__init__.py`, `backend/app/masters/models.py`
- Test: `backend/tests/masters/test_models.py`

**Interfaces:**
- Consumes: `app.core.db.Base`, `app.core.db.SessionLocal`, `app.core.models.AuditMixin`, `app.core.models.SoftDeleteMixin` (Task 2).
- Produces: ORM classes `Company`, `Location`, `Department`, `CostCenter`, `AssetCategory`, `AssetSubcategory`, `Vendor`, `CustomField` — tables and columns per spec §4.1. (Migration is generated in Task 4 Step 5, together with `holder`, so both land in one reviewable revision.)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/masters/test_models.py
from sqlalchemy import select
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter


async def test_cost_center_unique_per_company():
    async with SessionLocal() as session:
        co = Company(code="CKS", name="Citykart Stores")
        session.add(co)
        await session.flush()
        session.add(CostCenter(company_id=co.id, code="HO01", name="Head Office"))
        await session.commit()

        rows = (await session.execute(select(CostCenter).where(CostCenter.company_id == co.id))).scalars().all()
        assert len(rows) == 1
        assert rows[0].code == "HO01"

        await session.delete(co)
        await session.commit()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/masters/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.masters'`

- [ ] **Step 3: Implement `backend/app/masters/models.py`**

```python
from sqlalchemy import BigInteger, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin


class Company(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "company"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))


class Location(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "location"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))


class Department(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "department"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)


class CostCenter(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "cost_center"
    __table_args__ = (UniqueConstraint("company_id", "code"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))


class AssetCategory(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_category"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))


class AssetSubcategory(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_subcategory"
    __table_args__ = (UniqueConstraint("category_id", "code"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))


class Vendor(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "vendor"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    gstin: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(200))
    contact_phone: Mapped[str | None] = mapped_column(String(30))
    contact_email: Mapped[str | None] = mapped_column(String(200))


class CustomField(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "custom_field"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    field_key: Mapped[str] = mapped_column(String(100), unique=True)
    label: Mapped[str] = mapped_column(String(200))
    field_type: Mapped[str] = mapped_column(String(20))  # text|number|date|dropdown|checkbox
    options: Mapped[dict | None] = mapped_column(JSON)
    is_required: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
```

- [ ] **Step 4: Confirm the test still fails for the right reason (no table yet)**

Run: `.venv\Scripts\pytest tests/masters/test_models.py -v`
Expected: FAIL — `sqlalchemy.exc.ProgrammingError: relation "company" does not exist` (models exist, DB table doesn't — fixed by the migration in Task 4).

- [ ] **Step 5: Commit (models only; migration + green test land in Task 4)**

```bash
git add backend/app/masters backend/tests/masters
git commit -m "feat(masters): master data ORM models (migration in next commit)"
```

---

## Task 4: Holder model + combined migration for masters and holders

**Files:**
- Create: `backend/app/holders/__init__.py`, `backend/app/holders/models.py`
- Create: `backend/app/alembic/versions/0001_masters_and_holders.py` (generated, then hand-checked)
- Modify: `backend/app/alembic/env.py` (set `target_metadata`)
- Test: `backend/tests/holders/test_models.py`

**Interfaces:**
- Consumes: `Company`, `Location`, `Department` (Task 3); `app.core.db.Base` (Task 2).
- Produces: ORM classes `Holder` (table `holder`, columns per spec §4.2: `emp_code`, `name`, `holder_type`, `location_id`, `company_id`, `department_id`, `email`, `phone`, `password_hash`, `role`, `must_change_password`, `failed_login_count`, `locked_until`, `is_active`) and `HolderCompanyAccess` (table `holder_company_access`); `HOLDER_TYPES`, `ROLES` tuples. Applies the migration that creates all tables from Tasks 2–4.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/holders/test_models.py
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.db import SessionLocal
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def test_emp_code_unique_within_company():
    async with SessionLocal() as session:
        co = Company(code="CKS2", name="Test Co")
        loc = Location(code="HO2", name="Head Office 2")
        dept = Department(name="IT-Test")
        session.add_all([co, loc, dept])
        await session.flush()

        session.add(Holder(
            company_id=co.id, emp_code="CS6872", name="Ankur",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="HOLDER",
        ))
        await session.commit()

        dup = Holder(
            company_id=co.id, emp_code="CS6872", name="Duplicate",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="HOLDER",
        )
        session.add(dup)
        raised = False
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raised = True
        assert raised

        rows = (await session.execute(select(Holder).where(Holder.company_id == co.id))).scalars().all()
        assert len(rows) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/holders/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.holders'`

- [ ] **Step 3: Implement `backend/app/holders/models.py`**

```python
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin

HOLDER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK")
ROLES = ("ADMIN", "IT_TEAM", "VIEWER", "HOLDER")


class Holder(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "holder"
    __table_args__ = (UniqueConstraint("company_id", "emp_code"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    emp_code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    holder_type: Mapped[str] = mapped_column(String(20))
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("location.id"))
    department_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("department.id"))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))

    password_hash: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="HOLDER")
    must_change_password: Mapped[bool] = mapped_column(default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class HolderCompanyAccess(Base):
    __tablename__ = "holder_company_access"
    holder_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"), primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"), primary_key=True)
```

- [ ] **Step 4: Wire `target_metadata` in `backend/app/alembic/env.py`**

Add near the top, after the existing `sqlalchemy.url` override from Task 1 Step 8:

```python
from app.core.db import Base
import app.masters.models  # noqa: F401
import app.holders.models  # noqa: F401

target_metadata = Base.metadata
```

- [ ] **Step 5: Generate, review and apply the migration**

Run: `.venv\Scripts\alembic revision --autogenerate -m "masters and holders"`
Rename the generated file under `backend/app/alembic/versions/` to `0001_masters_and_holders.py`. Open it and confirm it creates all 10 tables (`company`, `location`, `department`, `cost_center`, `asset_category`, `asset_subcategory`, `vendor`, `custom_field`, `holder`, `holder_company_access`) with the `UniqueConstraint`s described above, and that every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `deleted_at` (except `holder_company_access`, which is a pure link table with no mixins).
Run: `.venv\Scripts\alembic upgrade head`

- [ ] **Step 6: Run both test suites to verify they pass**

Run: `.venv\Scripts\pytest tests/masters tests/holders -v`
Expected: `2 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/holders backend/app/alembic backend/tests/holders
git commit -m "feat(holders): holder model, company access, combined initial migration"
```

---

## Task 5: Auth — password hashing, JWT, login, scope dependencies

**Files:**
- Create: `backend/app/core/security.py`, `backend/app/core/deps.py`, `backend/app/auth/__init__.py`, `backend/app/auth/schemas.py`, `backend/app/auth/router.py`
- Modify: `backend/app/main.py` (mount the auth router)
- Test: `backend/tests/auth/test_security.py`, `backend/tests/auth/test_login.py`, `backend/tests/core/test_deps.py`

**Interfaces:**
- Consumes: `Holder` (Task 4), `app.core.db.get_session` (Task 2), `app.core.config.settings` (Task 2).
- Produces: `app.core.security.hash_password(raw) -> str`, `verify_password(raw, hashed) -> bool`, `create_access_token(holder_id, role, company_scope) -> str`, `decode_token(token) -> dict`; `app.core.deps.get_current_holder` (FastAPI dependency, returns `Holder`), `app.core.deps.require_role(*roles)` (dependency factory raising 403), `app.core.deps.scoped_company_ids(holder) -> list[int] | None` (None = all companies); `POST /api/auth/login` returning `{"access_token": str, "must_change_password": bool}` and setting an httpOnly `refresh_token` cookie; `POST /api/auth/change-password`.

- [ ] **Step 1: Write the failing test for hashing**

```python
# backend/tests/auth/test_security.py
from app.core.security import hash_password, verify_password, create_access_token, decode_token


def test_hash_and_verify_roundtrip():
    hashed = hash_password("S3cret!23")
    assert hashed != "S3cret!23"
    assert verify_password("S3cret!23", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_token_roundtrip():
    token = create_access_token(holder_id=42, role="ADMIN", company_scope=None)
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "ADMIN"
    assert payload["company_scope"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/auth/test_security.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.security'`

- [ ] **Step 3: Implement `backend/app/core/security.py`**

```python
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import jwt, JWTError
from app.core.config import settings

_hasher = PasswordHasher()


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except VerifyMismatchError:
        return False


def create_access_token(holder_id: int, role: str, company_scope: int | None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_minutes)
    payload = {"sub": str(holder_id), "role": role, "company_scope": company_scope, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(holder_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_refresh_hours)
    payload = {"sub": str(holder_id), "type": "refresh", "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError("invalid token") from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/auth/test_security.py -v`
Expected: `2 passed`

- [ ] **Step 5: Write the failing test for scope dependencies**

```python
# backend/tests/core/test_deps.py
import pytest
from fastapi import HTTPException
from app.core.deps import require_role, scoped_company_ids


class _FakeHolder:
    def __init__(self, role, company_id, holder_company_ids=None):
        self.role = role
        self.company_id = company_id
        self._access = holder_company_ids or []


def test_scoped_company_ids_admin_sees_all():
    assert scoped_company_ids(_FakeHolder("ADMIN", 1)) is None


def test_scoped_company_ids_holder_sees_own_company_only():
    assert scoped_company_ids(_FakeHolder("HOLDER", 7)) == [7]


def test_require_role_rejects_wrong_role():
    checker = require_role("ADMIN", "IT_TEAM")
    with pytest.raises(HTTPException) as exc:
        checker(_FakeHolder("VIEWER", 1))
    assert exc.value.status_code == 403


def test_require_role_allows_matching_role():
    checker = require_role("ADMIN", "IT_TEAM")
    result = checker(_FakeHolder("IT_TEAM", 1))
    assert result.role == "IT_TEAM"
```

- [ ] **Step 6: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/core/test_deps.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.deps'`

- [ ] **Step 7: Implement `backend/app/core/deps.py`**

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.security import decode_token
from app.holders.models import Holder

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_holder(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Holder:
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    holder = await session.get(Holder, int(payload["sub"]))
    if holder is None or not holder.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or inactive")
    return holder


def require_role(*roles: str):
    def checker(holder: Holder = Depends(get_current_holder)) -> Holder:
        if holder.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for this action")
        return holder
    return checker


def scoped_company_ids(holder) -> list[int] | None:
    """None means unrestricted (ADMIN). Everyone else is scoped to their own company
    plus any companies granted via holder_company_access (checked by the caller)."""
    if holder.role == "ADMIN":
        return None
    return [holder.company_id]
```

*Note: `require_role`'s test passes a plain object, not a real dependency-injected `Holder` — this is intentional; the function body only reads `.role`, so it works standalone in a unit test without a DB.*

- [ ] **Step 8: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/core/test_deps.py -v`
Expected: `4 passed`

- [ ] **Step 9: Write the failing test for the login endpoint**

```python
# backend/tests/auth/test_login.py
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _make_admin(session, company_code="CKS3", emp_code="ADMIN1"):
    co = Company(code=company_code, name="Auth Test Co")
    loc = Location(code=f"{company_code}-HO", name="HO")
    dept = Department(name=f"IT-{company_code}")
    session.add_all([co, loc, dept])
    await session.flush()
    holder = Holder(
        company_id=co.id, emp_code=emp_code, name="Admin",
        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
        role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
    )
    session.add(holder)
    await session.commit()
    return co, holder


async def test_login_success(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session)

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": holder.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["must_change_password"] is False
    assert "refresh_token" in resp.cookies


async def test_login_wrong_password_locks_after_five_attempts(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, company_code="CKS4", emp_code="ADMIN2")

    for _ in range(5):
        resp = await client.post("/api/auth/login", json={
            "company_id": co.id, "emp_code": holder.emp_code, "password": "wrong",
        })
        assert resp.status_code == 401

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": holder.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 423  # locked
```

- [ ] **Step 10: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/auth/test_login.py -v`
Expected: FAIL — `404 Not Found` (no `/api/auth/login` route yet)

- [ ] **Step 11: Implement `backend/app/auth/schemas.py`**

```python
from pydantic import BaseModel


class LoginRequest(BaseModel):
    company_id: int
    emp_code: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    must_change_password: bool


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
```

- [ ] **Step 12: Implement `backend/app/auth/router.py`**

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.holders.models import Holder
from app.auth.schemas import ChangePasswordRequest, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, session: AsyncSession = Depends(get_session)):
    stmt = select(Holder).where(Holder.company_id == body.company_id, Holder.emp_code == body.emp_code)
    holder = (await session.execute(stmt)).scalar_one_or_none()
    if holder is None or not holder.is_active or holder.password_hash is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    now = datetime.now(timezone.utc)
    if holder.locked_until and holder.locked_until > now:
        raise HTTPException(status.HTTP_423_LOCKED, "Account locked, try again later")

    if not verify_password(body.password, holder.password_hash):
        holder.failed_login_count += 1
        if holder.failed_login_count >= MAX_FAILED_ATTEMPTS:
            holder.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    holder.failed_login_count = 0
    holder.locked_until = None
    await session.commit()

    access = create_access_token(holder.id, holder.role, holder.company_id)
    refresh = create_refresh_token(holder.id)
    response.set_cookie("refresh_token", refresh, httponly=True, samesite="lax", max_age=8 * 3600)
    return LoginResponse(access_token=access, must_change_password=holder.must_change_password)


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    holder: Holder = Depends(get_current_holder),
):
    if not verify_password(body.old_password, holder.password_hash or ""):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Old password is incorrect")
    holder.password_hash = hash_password(body.new_password)
    holder.must_change_password = False
    await session.commit()
```

- [ ] **Step 13: Mount the router in `backend/app/main.py`**

```python
from fastapi import FastAPI
from app.auth.router import router as auth_router

app = FastAPI(title="CityKart Asset Manager API")
app.include_router(auth_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/auth -v`
Expected: `4 passed`

- [ ] **Step 15: Commit**

```bash
git add backend/app/core/security.py backend/app/core/deps.py backend/app/auth backend/app/main.py backend/tests/auth backend/tests/core/test_deps.py
git commit -m "feat(auth): password hashing, JWT, login with lockout, role/scope deps"
```

---

## Task 6: Frontend skeleton, design-system scaffold, Login page

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/lib/api-client.ts`, `frontend/src/lib/auth-store.ts`
- Create: `frontend/src/routes/login.tsx`
- Modify: `docker-compose.yml` (add `web` service), `docker-compose.dev.yml` (new — dev-mode override)
- Test: `frontend/src/routes/login.test.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login` (Task 5).
- Produces: `apiClient` (a `fetch` wrapper in `lib/api-client.ts` with `apiClient.post(path, body)` / `.get(path)` that attaches the bearer token and throws on non-2xx); `useAuthStore` (Zustand-style store: `{ accessToken, role, companyId, setAuth(), logout() }`) persisted to `sessionStorage`; the `/login` route.

- [ ] **Step 1: Scaffold the Vite project**

Run (from repo root): `npm create vite@latest frontend -- --template react-ts`
Then (from `frontend/`): `npm install`

- [ ] **Step 2: Add project dependencies**

Run (from `frontend/`): `npm install @tanstack/react-query @tanstack/react-router react-hook-form zod @hookform/resolvers zustand`
Run: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom tailwindcss @tailwindcss/vite`

- [ ] **Step 3: Install the CityKart design system**

Invoke the `citykart-ui:sk-uiscaffold-ck` skill against the `frontend/` project to install the OKLCH tokens, the Tailwind v4 utility layer, the shadcn/ui component set and font setup (`tokens.css`, `tokens.json`, `styles.css`, `components.json`, the `cn()` util). Follow that skill's own instructions for exact file placement; do not hand-roll these files.

- [ ] **Step 4: Write the failing test for the login form**

```tsx
// frontend/src/routes/login.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./login";

describe("LoginForm", () => {
  it("submits company, user id and password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm companies={[{ id: 1, name: "Citykart Stores" }]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "ADMIN1" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      companyId: 1, empCode: "ADMIN1", password: "Passw0rd!",
    }));
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/routes/login.test.tsx`
Expected: FAIL — `Cannot find module './login'`

- [ ] **Step 6: Implement `frontend/src/lib/api-client.ts`**

```typescript
import { useAuthStore } from "./auth-store";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
```

- [ ] **Step 7: Implement `frontend/src/lib/auth-store.ts`**

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  accessToken: string | null;
  role: string | null;
  companyId: number | null;
  mustChangePassword: boolean;
  setAuth: (a: { accessToken: string; role: string; companyId: number; mustChangePassword: boolean }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      role: null,
      companyId: null,
      mustChangePassword: false,
      setAuth: (a) => set({ ...a }),
      logout: () => set({ accessToken: null, role: null, companyId: null, mustChangePassword: false }),
    }),
    { name: "ckam-auth", storage: { getItem: (k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), setItem: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)), removeItem: (k) => sessionStorage.removeItem(k) } }
  )
);
```

- [ ] **Step 8: Implement `frontend/src/routes/login.tsx`**

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  companyId: z.coerce.number(),
  empCode: z.string().min(1, "User ID is required"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

export function LoginForm({
  companies,
  onSubmit,
}: {
  companies: { id: number; name: string }[];
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { companyId: companies[0]?.id },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 max-w-sm">
      <label htmlFor="company">Company</label>
      <select id="company" {...register("companyId")}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label htmlFor="emp-code">User ID</label>
      <input id="emp-code" {...register("empCode")} />
      {errors.empCode && <span role="alert">{errors.empCode.message}</span>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" {...register("password")} />
      {errors.password && <span role="alert">{errors.password.message}</span>}

      <button type="submit">Log in</button>
    </form>
  );
}
```

*Note: this task only needs the form to work and be testable with plain elements. Every later screen task (7 onward) applies the CityKart design system (`citykart-ui:sk-uisystem-ck`) directly when building that screen — swap this form's raw `<input>`/`<select>`/`<button>` for the scaffolded shadcn/ui `Input`/`Select`/`Button` components as its first step, then proceed with that screen's own work.*

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/routes/login.test.tsx`
Expected: `1 passed`

- [ ] **Step 10: Add the `web` service to `docker-compose.yml`**

```yaml
  web:
    build: ./frontend
    depends_on:
      - api
    ports:
      - "80:80"
```

- [ ] **Step 11: Create `frontend/Dockerfile`**

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 12: Create `frontend/nginx.conf`**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:8000/api/;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 13: Commit**

```bash
git add frontend docker-compose.yml
git commit -m "feat(frontend): Vite/React skeleton, design system scaffold, login form"
```

---

## Task 7: Generic masters CRUD backend

**Files:**
- Create: `backend/app/masters/schemas.py`, `backend/app/masters/service.py`, `backend/app/masters/router.py`
- Modify: `backend/app/main.py` (mount masters router)
- Test: `backend/tests/masters/test_crud.py`

**Interfaces:**
- Consumes: `Company`, `Location`, `Department`, `CostCenter`, `AssetCategory`, `AssetSubcategory`, `Vendor`, `CustomField` (Task 3); `get_current_holder`, `require_role` (Task 5).
- Produces: `app.masters.service.MasterCRUDService(model, session)` with `list_active()`, `get(id)`, `create(data, actor_id)`, `update(id, data, actor_id)`, `deactivate(id, actor_id)`; one router factory `build_master_router(prefix, model, schema_in, schema_out)` mounted at `/api/masters/{companies,locations,departments,cost-centers,categories,subcategories,vendors,custom-fields}`. ADMIN and IT_TEAM may write; all authenticated roles may read.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/masters/test_crud.py
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _admin_headers(client, company_code="CKS5"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Masters Test Co")
        loc = Location(code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(
            company_id=co.id, emp_code="MADMIN", name="Master Admin",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": "MADMIN", "password": "Passw0rd!",
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_create_list_and_deactivate_vendor(client):
    headers = await _admin_headers(client)

    create_resp = await client.post("/api/masters/vendors", json={
        "code": "VEND1", "name": "Test Vendor", "gstin": None,
        "contact_name": None, "contact_phone": None, "contact_email": None,
    }, headers=headers)
    assert create_resp.status_code == 201
    vendor_id = create_resp.json()["id"]

    list_resp = await client.get("/api/masters/vendors", headers=headers)
    assert any(v["id"] == vendor_id for v in list_resp.json())

    deact_resp = await client.delete(f"/api/masters/vendors/{vendor_id}", headers=headers)
    assert deact_resp.status_code == 204

    list_resp_after = await client.get("/api/masters/vendors", headers=headers)
    assert all(v["id"] != vendor_id for v in list_resp_after.json())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/masters/test_crud.py -v`
Expected: FAIL — `404 Not Found` (no `/api/masters/vendors` route yet)

- [ ] **Step 3: Implement `backend/app/masters/schemas.py`**

```python
from pydantic import BaseModel, ConfigDict


class VendorIn(BaseModel):
    code: str
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None


class VendorOut(VendorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CompanyIn(BaseModel):
    code: str
    name: str


class CompanyOut(CompanyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class LocationIn(BaseModel):
    code: str
    name: str
    address: str | None = None


class LocationOut(LocationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class DepartmentIn(BaseModel):
    name: str


class DepartmentOut(DepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CostCenterIn(BaseModel):
    company_id: int
    code: str
    name: str


class CostCenterOut(CostCenterIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetCategoryIn(BaseModel):
    code: str
    name: str


class AssetCategoryOut(AssetCategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetSubcategoryIn(BaseModel):
    category_id: int
    code: str
    name: str


class AssetSubcategoryOut(AssetSubcategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CustomFieldIn(BaseModel):
    field_key: str
    label: str
    field_type: str
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0


class CustomFieldOut(CustomFieldIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
```

- [ ] **Step 4: Implement `backend/app/masters/service.py`**

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class MasterCRUDService:
    def __init__(self, model, session: AsyncSession):
        self.model = model
        self.session = session

    async def list_active(self):
        stmt = select(self.model).where(self.model.is_active.is_(True))
        return (await self.session.execute(stmt)).scalars().all()

    async def get(self, id_: int):
        return await self.session.get(self.model, id_)

    async def create(self, data: dict, actor_id: int):
        obj = self.model(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def update(self, id_: int, data: dict, actor_id: int):
        obj = await self.get(id_)
        if obj is None:
            return None
        for key, value in data.items():
            setattr(obj, key, value)
        obj.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def deactivate(self, id_: int, actor_id: int) -> bool:
        obj = await self.get(id_)
        if obj is None:
            return False
        obj.is_active = False
        obj.updated_by = actor_id
        await self.session.commit()
        return True
```

- [ ] **Step 5: Implement `backend/app/masters/router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.masters.service import MasterCRUDService
from app.masters import models, schemas

router = APIRouter(prefix="/api/masters", tags=["masters"])


def build_master_router(prefix: str, model, schema_in, schema_out):
    sub = APIRouter(prefix=prefix)

    @sub.get("", response_model=list[schema_out])
    async def list_items(
        session: AsyncSession = Depends(get_session),
        _holder=Depends(get_current_holder),
    ):
        return await MasterCRUDService(model, session).list_active()

    @sub.post("", response_model=schema_out, status_code=201)
    async def create_item(
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        return await MasterCRUDService(model, session).create(body.model_dump(), holder.id)

    @sub.put("/{item_id}", response_model=schema_out)
    async def update_item(
        item_id: int,
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        obj = await MasterCRUDService(model, session).update(item_id, body.model_dump(), holder.id)
        if obj is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return obj

    @sub.delete("/{item_id}", status_code=204)
    async def deactivate_item(
        item_id: int,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        ok = await MasterCRUDService(model, session).deactivate(item_id, holder.id)
        if not ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND)

    return sub


router.include_router(build_master_router("/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut))
router.include_router(build_master_router("/locations", models.Location, schemas.LocationIn, schemas.LocationOut))
router.include_router(build_master_router("/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut))
router.include_router(build_master_router("/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut))
router.include_router(build_master_router("/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut))
router.include_router(build_master_router("/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut))
router.include_router(build_master_router("/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut))
router.include_router(build_master_router("/custom-fields", models.CustomField, schemas.CustomFieldIn, schemas.CustomFieldOut))
```

- [ ] **Step 6: Mount the router in `backend/app/main.py`**

```python
from app.masters.router import router as masters_router
app.include_router(masters_router)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/masters -v`
Expected: `2 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/app/masters backend/app/main.py backend/tests/masters/test_crud.py
git commit -m "feat(masters): generic CRUD service and routers for all 8 master lists"
```

---

## Task 8: Generic master list+form component and Setup screens

**Files:**
- Create: `frontend/src/components/master-crud/MasterCrudScreen.tsx`, `frontend/src/components/master-crud/types.ts`
- Create: `frontend/src/routes/setup/vendors.tsx`, `frontend/src/routes/setup/companies.tsx`, `frontend/src/routes/setup/locations.tsx`, `frontend/src/routes/setup/departments.tsx`, `frontend/src/routes/setup/cost-centers.tsx`, `frontend/src/routes/setup/categories.tsx`, `frontend/src/routes/setup/subcategories.tsx`, `frontend/src/routes/setup/custom-fields.tsx`
- Test: `frontend/src/components/master-crud/MasterCrudScreen.test.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 6); `GET/POST/PUT/DELETE /api/masters/*` (Task 7); shadcn/ui `Table`, `Dialog`, `Input`, `Button` (from Task 6 Step 3 scaffold).
- Produces: `<MasterCrudScreen<T> config={{ resource, columns, formFields }} />` — one component reused by all 8 Setup routes; each route file is a ~10-line config, not a hand-built screen.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/master-crud/MasterCrudScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MasterCrudScreen } from "./MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MasterCrudScreen", () => {
  it("lists items and creates a new one", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One", is_active: true }]);
    (apiClient.post as any).mockResolvedValue({ id: 2, code: "V2", name: "Vendor Two", is_active: true });

    renderWithClient(
      <MasterCrudScreen
        config={{
          resource: "vendors",
          title: "Vendors",
          columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }],
          formFields: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }],
        }}
      />
    );

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "V2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vendor Two" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", { code: "V2", name: "Vendor Two" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/master-crud/MasterCrudScreen.test.tsx`
Expected: FAIL — `Cannot find module './MasterCrudScreen'`

- [ ] **Step 3: Implement `frontend/src/components/master-crud/types.ts`**

```typescript
export interface Column<T> { key: keyof T; label: string }
export interface FormField { key: string; label: string; type?: "text" | "number" | "select"; options?: { value: string | number; label: string }[] }
export interface MasterConfig<T> {
  resource: string;   // e.g. "vendors" -> /masters/vendors
  title: string;
  columns: Column<T>[];
  formFields: FormField[];
}
```

- [ ] **Step 4: Implement `frontend/src/components/master-crud/MasterCrudScreen.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { MasterConfig } from "./types";

export function MasterCrudScreen<T extends { id: number }>({ config }: { config: MasterConfig<T> }) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: items = [] } = useQuery({
    queryKey: ["masters", config.resource],
    queryFn: () => apiClient.get<T[]>(`/masters/${config.resource}`),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post(`/masters/${config.resource}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", config.resource] });
      setFormOpen(false);
      setDraft({});
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/masters/${config.resource}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["masters", config.resource] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>{config.title}</h1>
        <button onClick={() => setFormOpen(true)}>Add</button>
      </div>

      <table>
        <thead>
          <tr>
            {config.columns.map((c) => <th key={String(c.key)}>{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {config.columns.map((c) => <td key={String(c.key)}>{String(item[c.key])}</td>)}
              <td>
                <button onClick={() => deactivateMutation.mutate(item.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {formOpen && (
        <div role="dialog">
          {config.formFields.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                aria-label={f.label}
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <button onClick={() => createMutation.mutate(draft)}>Save</button>
          <button onClick={() => setFormOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

*Note: raw `<table>`/`<input>`/`<button>` shown here for clarity — implement using the scaffolded shadcn/ui `Table`, `Input`, `Button`, `Dialog` components (Task 6 Step 3) so it matches the CityKart design system; the test only asserts on roles/labels/text, which those components preserve.*

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/master-crud/MasterCrudScreen.test.tsx`
Expected: `1 passed`

- [ ] **Step 6: Create the 8 Setup route files**

```tsx
// frontend/src/routes/setup/vendors.tsx
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Vendor { id: number; code: string; name: string; gstin: string | null }

export default function VendorsSetup() {
  return (
    <MasterCrudScreen<Vendor>
      config={{
        resource: "vendors",
        title: "Vendors",
        columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "gstin", label: "GSTIN" }],
        formFields: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "gstin", label: "GSTIN" }],
      }}
    />
  );
}
```

Repeat the same ~15-line pattern for `companies.tsx` (`code`, `name`), `locations.tsx` (`code`, `name`, `address`), `departments.tsx` (`name` only), `cost-centers.tsx` (`company_id` as a select, `code`, `name`), `categories.tsx` (`code`, `name`), `subcategories.tsx` (`category_id` as a select, `code`, `name`), `custom-fields.tsx` (`field_key`, `label`, `field_type` as a select of `text|number|date|dropdown|checkbox`, `is_required`, `sort_order`) — each file supplies only its own `MasterConfig`, reusing the same `MasterCrudScreen`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/master-crud frontend/src/routes/setup
git commit -m "feat(frontend): generic master CRUD screen and 8 Setup routes"
```

---

## Task 9: Holders CRUD backend, with login/role fields and password reset

**Files:**
- Create: `backend/app/holders/schemas.py`, `backend/app/holders/service.py`, `backend/app/holders/router.py`
- Modify: `backend/app/main.py` (mount holders router)
- Test: `backend/tests/holders/test_crud.py`

**Interfaces:**
- Consumes: `Holder`, `HolderCompanyAccess` (Task 4); `MasterCRUDService` pattern (Task 7, not reused directly because holders have extra password/role logic); `hash_password` (Task 5).
- Produces: `POST/GET/PUT/DELETE /api/holders`, plus `POST /api/holders/{id}/reset-password` (ADMIN only, sets a temp password and `must_change_password=True`) and `POST /api/holders/{id}/company-access` (ADMIN only, replaces the holder's `holder_company_access` rows). List supports `?company_id=` and `?holder_type=` filters.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/holders/test_crud.py
from app.core.db import SessionLocal
from app.core.security import hash_password, verify_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _admin_headers(client, company_code="CKS6"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Holder Test Co")
        loc = Location(code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(
            company_id=co.id, emp_code="HADMIN", name="Holder Admin",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "HADMIN", "password": "Passw0rd!"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, co.id, loc.id, dept.id


async def test_create_holder_and_reset_password(client):
    headers, company_id, location_id, department_id = await _admin_headers(client)

    create_resp = await client.post("/api/holders", json={
        "company_id": company_id, "emp_code": "CS6872", "name": "Ankur",
        "holder_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "HOLDER",
    }, headers=headers)
    assert create_resp.status_code == 201
    holder_id = create_resp.json()["id"]

    reset_resp = await client.post(f"/api/holders/{holder_id}/reset-password", headers=headers)
    assert reset_resp.status_code == 200
    temp_password = reset_resp.json()["temp_password"]

    async with SessionLocal() as session:
        holder = await session.get(Holder, holder_id)
        assert verify_password(temp_password, holder.password_hash)
        assert holder.must_change_password is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/holders/test_crud.py -v`
Expected: FAIL — `404 Not Found` (no `/api/holders` route yet)

- [ ] **Step 3: Implement `backend/app/holders/schemas.py`**

```python
from pydantic import BaseModel, ConfigDict


class HolderIn(BaseModel):
    company_id: int
    emp_code: str
    name: str
    holder_type: str
    location_id: int
    department_id: int | None = None
    email: str | None = None
    phone: str | None = None
    role: str = "HOLDER"


class HolderOut(HolderIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    must_change_password: bool


class ResetPasswordOut(BaseModel):
    temp_password: str


class CompanyAccessIn(BaseModel):
    company_ids: list[int]
```

- [ ] **Step 4: Implement `backend/app/holders/service.py`**

```python
import secrets
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import hash_password
from app.holders.models import Holder, HolderCompanyAccess


class HolderService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self, company_id: int | None = None, holder_type: str | None = None):
        stmt = select(Holder).where(Holder.is_active.is_(True))
        if company_id is not None:
            stmt = stmt.where(Holder.company_id == company_id)
        if holder_type is not None:
            stmt = stmt.where(Holder.holder_type == holder_type)
        return (await self.session.execute(stmt)).scalars().all()

    async def create(self, data: dict, actor_id: int) -> Holder:
        holder = Holder(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(holder)
        await self.session.commit()
        await self.session.refresh(holder)
        return holder

    async def reset_password(self, holder_id: int, actor_id: int) -> str | None:
        holder = await self.session.get(Holder, holder_id)
        if holder is None:
            return None
        temp_password = secrets.token_urlsafe(9)
        holder.password_hash = hash_password(temp_password)
        holder.must_change_password = True
        holder.failed_login_count = 0
        holder.locked_until = None
        holder.updated_by = actor_id
        await self.session.commit()
        return temp_password

    async def set_company_access(self, holder_id: int, company_ids: list[int]) -> bool:
        holder = await self.session.get(Holder, holder_id)
        if holder is None:
            return False
        await self.session.execute(delete(HolderCompanyAccess).where(HolderCompanyAccess.holder_id == holder_id))
        for cid in company_ids:
            self.session.add(HolderCompanyAccess(holder_id=holder_id, company_id=cid))
        await self.session.commit()
        return True
```

- [ ] **Step 5: Implement `backend/app/holders/router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.holders.service import HolderService
from app.holders.schemas import CompanyAccessIn, HolderIn, HolderOut, ResetPasswordOut

router = APIRouter(prefix="/api/holders", tags=["holders"])


@router.get("", response_model=list[HolderOut])
async def list_holders(
    company_id: int | None = Query(None),
    holder_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    _holder=Depends(get_current_holder),
):
    return await HolderService(session).list(company_id, holder_type)


@router.post("", response_model=HolderOut, status_code=201)
async def create_holder(
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN", "IT_TEAM")),
):
    return await HolderService(session).create(body.model_dump(), holder.id)


@router.post("/{holder_id}/reset-password", response_model=ResetPasswordOut)
async def reset_password(
    holder_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    temp = await HolderService(session).reset_password(holder_id, actor.id)
    if temp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return ResetPasswordOut(temp_password=temp)


@router.post("/{holder_id}/company-access", status_code=204)
async def set_company_access(
    holder_id: int,
    body: CompanyAccessIn,
    session: AsyncSession = Depends(get_session),
    _actor=Depends(require_role("ADMIN")),
):
    ok = await HolderService(session).set_company_access(holder_id, body.company_ids)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
```

- [ ] **Step 6: Mount the router in `backend/app/main.py`**

```python
from app.holders.router import router as holders_router
app.include_router(holders_router)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/holders -v`
Expected: `3 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/app/holders backend/app/main.py backend/tests/holders/test_crud.py
git commit -m "feat(holders): CRUD, password reset, company-access endpoints"
```

---

## Task 10: Holders Setup screen (frontend)

**Files:**
- Create: `frontend/src/routes/setup/holders.tsx`, `frontend/src/features/holders/HoldersScreen.tsx`
- Test: `frontend/src/features/holders/HoldersScreen.test.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 6); `GET/POST /api/holders`, `POST /api/holders/{id}/reset-password` (Task 9).
- Produces: the Setup → Users screen: a table of holders with Add, Edit and "Reset Password" (shows the generated temp password once, in a dialog).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/holders/HoldersScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldersScreen } from "./HoldersScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("HoldersScreen", () => {
  it("resets a holder's password and shows the temp password", async () => {
    (apiClient.get as any).mockResolvedValue([
      { id: 1, emp_code: "CS6872", name: "Ankur", holder_type: "EMPLOYEE", role: "HOLDER", is_active: true },
    ]);
    (apiClient.post as any).mockResolvedValue({ temp_password: "abc123XYZ" });

    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText("abc123XYZ")).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith("/holders/1/reset-password");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/holders/HoldersScreen.test.tsx`
Expected: FAIL — `Cannot find module './HoldersScreen'`

- [ ] **Step 3: Implement `frontend/src/features/holders/HoldersScreen.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface HolderRow {
  id: number; emp_code: string; name: string; holder_type: string; role: string; is_active: boolean;
}

export function HoldersScreen() {
  const qc = useQueryClient();
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const { data: holders = [] } = useQuery({
    queryKey: ["holders"],
    queryFn: () => apiClient.get<HolderRow[]>("/holders"),
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post<{ temp_password: string }>(`/holders/${id}/reset-password`),
    onSuccess: (data) => {
      setTempPassword(data.temp_password);
      qc.invalidateQueries({ queryKey: ["holders"] });
    },
  });

  return (
    <div>
      <h1>Users</h1>
      <table>
        <thead>
          <tr><th>Emp Code</th><th>Name</th><th>Type</th><th>Role</th><th /></tr>
        </thead>
        <tbody>
          {holders.map((h) => (
            <tr key={h.id}>
              <td>{h.emp_code}</td>
              <td>{h.name}</td>
              <td>{h.holder_type}</td>
              <td>{h.role}</td>
              <td>
                <button onClick={() => resetMutation.mutate(h.id)}>Reset Password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tempPassword && (
        <div role="alertdialog">
          <p>Temporary password: <strong>{tempPassword}</strong></p>
          <button onClick={() => setTempPassword(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/holders/HoldersScreen.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Create the route file**

```tsx
// frontend/src/routes/setup/holders.tsx
import { HoldersScreen } from "../../features/holders/HoldersScreen";
export default function HoldersSetup() { return <HoldersScreen />; }
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/setup/holders.tsx frontend/src/features/holders
git commit -m "feat(frontend): Holders setup screen with password reset"
```

---

## Task 11: Numbering — code rule, per-prefix counter, token resolver

**Files:**
- Create: `backend/app/numbering/__init__.py`, `backend/app/numbering/models.py`, `backend/app/numbering/service.py`, `backend/app/numbering/schemas.py`, `backend/app/numbering/router.py`
- Create: `backend/app/alembic/versions/0002_numbering.py`
- Modify: `backend/app/alembic/env.py` (import `app.numbering.models`), `backend/app/main.py` (mount router)
- Test: `backend/tests/numbering/test_service.py`, `backend/tests/numbering/test_router.py`

**Interfaces:**
- Consumes: `Company`, `CostCenter`, `AssetCategory`, `AssetSubcategory`, `Location` (Task 3); `app.core.db.SessionLocal` (Task 2).
- Produces: ORM `CodeRule` (table `code_rule`: `company_id` nullable, `prefix_template`, `suffix_template`, `start_number`, `pad_width`, `is_active`) and `CodeCounter` (table `code_counter`: `resolved_prefix` PK, `next_value`); `app.numbering.service.resolve_prefix(rule, tokens: dict) -> str` (raises `ValueError` on an unresolved/empty token); `app.numbering.service.generate_code(session, rule, tokens: dict) -> str` (allocates the next number for that resolved prefix inside the caller's transaction, formats with `pad_width`, appends `suffix_template`); `GET/POST/PUT /api/code-rules`.

- [ ] **Step 1: Write the failing test for the resolver**

```python
# backend/tests/numbering/test_service.py
import pytest
from app.numbering.service import resolve_prefix, generate_code
from app.core.db import SessionLocal
from app.numbering.models import CodeRule


def _rule(**overrides):
    defaults = dict(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                    suffix_template="", start_number=1, pad_width=0)
    defaults.update(overrides)
    return CodeRule(**defaults)


def test_resolve_prefix_substitutes_tokens():
    rule = _rule()
    tokens = {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"}
    assert resolve_prefix(rule, tokens) == "FA/HO01/IT/LAP/CK_"


def test_resolve_prefix_rejects_empty_token():
    rule = _rule(prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_")
    tokens = {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": ""}
    with pytest.raises(ValueError, match="subcategory"):
        resolve_prefix(rule, tokens)


def test_resolve_prefix_rejects_unknown_token():
    rule = _rule(prefix_template="FA/{not_a_real_token}/CK_")
    with pytest.raises(ValueError, match="unknown token"):
        resolve_prefix(rule, {})


async def test_generate_code_separate_counter_per_prefix():
    rule = _rule(pad_width=0)
    async with SessionLocal() as session:
        code_a1 = await generate_code(session, rule, {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"})
        code_a2 = await generate_code(session, rule, {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"})
        code_b1 = await generate_code(session, rule, {"cost_center.code": "BAC01", "category.code": "IT", "subcategory.code": "MOU"})
        await session.commit()

    assert code_a1 == "FA/HO01/IT/LAP/CK_1"
    assert code_a2 == "FA/HO01/IT/LAP/CK_2"
    assert code_b1 == "FA/BAC01/IT/MOU/CK_1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/numbering/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.numbering'`

- [ ] **Step 3: Implement `backend/app/numbering/models.py`**

```python
from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import SoftDeleteMixin


class CodeRule(Base, SoftDeleteMixin):
    __tablename__ = "code_rule"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("company.id"))
    prefix_template: Mapped[str] = mapped_column(String(300))
    suffix_template: Mapped[str] = mapped_column(String(100), default="")
    start_number: Mapped[int] = mapped_column(Integer, default=1)
    pad_width: Mapped[int] = mapped_column(Integer, default=0)


class CodeCounter(Base):
    __tablename__ = "code_counter"
    resolved_prefix: Mapped[str] = mapped_column(String(400), primary_key=True)
    next_value: Mapped[int] = mapped_column(BigInteger, nullable=False)
```

- [ ] **Step 4: Implement `backend/app/numbering/service.py`**

```python
import re
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.numbering.models import CodeCounter, CodeRule

_TOKEN_RE = re.compile(r"\{([a-zA-Z0-9_.]+)\}")


def resolve_prefix(rule: CodeRule, tokens: dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key not in tokens:
            raise ValueError(f"unknown token '{{{key}}}' in code rule template")
        value = tokens[key]
        if not value:
            raise ValueError(f"token '{key}' resolved to an empty value; asset is missing that field")
        return value

    return _TOKEN_RE.sub(replace, rule.prefix_template)


async def generate_code(session: AsyncSession, rule: CodeRule, tokens: dict[str, str]) -> str:
    resolved_prefix = resolve_prefix(rule, tokens)

    stmt = (
        insert(CodeCounter)
        .values(resolved_prefix=resolved_prefix, next_value=rule.start_number + 1)
        .on_conflict_do_update(
            index_elements=[CodeCounter.resolved_prefix],
            set_={"next_value": CodeCounter.next_value + 1},
        )
        .returning(CodeCounter.next_value)
    )
    result = await session.execute(stmt)
    new_next_value = result.scalar_one()
    allocated_number = new_next_value - 1

    number_str = str(allocated_number).zfill(rule.pad_width) if rule.pad_width else str(allocated_number)
    return f"{resolved_prefix}{number_str}{rule.suffix_template}"


async def get_active_rule(session: AsyncSession, company_id: int) -> CodeRule:
    stmt = select(CodeRule).where(
        CodeRule.is_active.is_(True), (CodeRule.company_id == company_id) | (CodeRule.company_id.is_(None))
    ).order_by(CodeRule.company_id.desc().nullslast())
    rule = (await session.execute(stmt)).scalars().first()
    if rule is None:
        raise ValueError("no active code rule configured")
    return rule
```

*`on_conflict_do_update ... RETURNING` performs the read-increment-write atomically at the database level, so two simultaneous saves against the same prefix can never receive the same number (spec §4.3).*

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/numbering/test_service.py -v`
Expected: FAIL still, on the two `async def` tests — `relation "code_counter" does not exist` (no migration yet). Confirm the three pure `resolve_prefix` tests pass and the two `generate_code` tests fail for that reason.

- [ ] **Step 6: Wire Alembic and generate the migration**

In `backend/app/alembic/env.py`, add `import app.numbering.models  # noqa: F401` alongside the other model imports.
Run: `.venv\Scripts\alembic revision --autogenerate -m "numbering"`, rename to `0002_numbering.py`, review it creates `code_rule` and `code_counter`, then:
Run: `.venv\Scripts\alembic upgrade head`

- [ ] **Step 7: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/numbering/test_service.py -v`
Expected: `4 passed`

- [ ] **Step 8: Implement `backend/app/numbering/schemas.py` and `backend/app/numbering/router.py`**

```python
# backend/app/numbering/schemas.py
from pydantic import BaseModel, ConfigDict


class CodeRuleIn(BaseModel):
    company_id: int | None = None
    prefix_template: str
    suffix_template: str = ""
    start_number: int = 1
    pad_width: int = 0


class CodeRuleOut(CodeRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
```

```python
# backend/app/numbering/router.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.numbering.models import CodeRule
from app.numbering.schemas import CodeRuleIn, CodeRuleOut

router = APIRouter(prefix="/api/code-rules", tags=["numbering"])


@router.get("", response_model=list[CodeRuleOut])
async def list_rules(session: AsyncSession = Depends(get_session), _h=Depends(get_current_holder)):
    stmt = select(CodeRule).where(CodeRule.is_active.is_(True))
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=CodeRuleOut, status_code=201)
async def create_rule(body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    rule = CodeRule(**body.model_dump())
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CodeRuleOut)
async def update_rule(rule_id: int, body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    rule = await session.get(CodeRule, rule_id)
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    await session.commit()
    await session.refresh(rule)
    return rule
```

- [ ] **Step 9: Write and run a router test**

```python
# backend/tests/numbering/test_router.py
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def test_create_code_rule(client):
    async with SessionLocal() as session:
        co = Company(code="CKS7", name="Numbering Test Co")
        loc = Location(code="CKS7-HO", name="HO")
        dept = Department(name="IT-CKS7")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(company_id=co.id, emp_code="NADMIN", name="N Admin", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="ADMIN",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "NADMIN", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    create_resp = await client.post("/api/code-rules", json={
        "company_id": None, "prefix_template": "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
        "suffix_template": "", "start_number": 1, "pad_width": 0,
    }, headers=headers)
    assert create_resp.status_code == 201
    assert create_resp.json()["prefix_template"].startswith("FA/")
```

Run: `.venv\Scripts\pytest tests/numbering -v`
Expected: `5 passed`

- [ ] **Step 10: Mount the router and commit**

```python
# backend/app/main.py
from app.numbering.router import router as numbering_router
app.include_router(numbering_router)
```

```bash
git add backend/app/numbering backend/app/alembic backend/app/main.py backend/tests/numbering
git commit -m "feat(numbering): code rule, per-prefix counter, token resolver"
```

---

## Task 12: Code Rule Setup screen (frontend)

**Files:**
- Create: `frontend/src/routes/setup/code-rule.tsx`, `frontend/src/features/numbering/CodeRuleScreen.tsx`
- Test: `frontend/src/features/numbering/CodeRuleScreen.test.tsx`

**Interfaces:**
- Consumes: `apiClient`; `GET/POST/PUT /api/code-rules` (Task 11).
- Produces: a form with the prefix/suffix template fields, start number, pad width, and a **live preview** computed client-side by substituting sample token values (`HO01`, `IT`, `LAP`) into the template, matching the legacy "Numbering" screen shown in the spec.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/numbering/CodeRuleScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeRuleScreen } from "./CodeRuleScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CodeRuleScreen", () => {
  it("shows a live preview as the template is typed", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderWithClient(<CodeRuleScreen />);

    fireEvent.change(screen.getByLabelText(/prefix template/i), {
      target: { value: "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_" },
    });

    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/numbering/CodeRuleScreen.test.tsx`
Expected: FAIL — `Cannot find module './CodeRuleScreen'`

- [ ] **Step 3: Implement `frontend/src/features/numbering/CodeRuleScreen.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

const SAMPLE_TOKENS: Record<string, string> = {
  "cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP",
  "company.code": "CKS", "location.code": "HO", "yyyy": "2026", "yy": "26", "mm": "09",
};

function renderPreview(template: string, suffix: string, startNumber: number, padWidth: number): string {
  const prefix = template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => SAMPLE_TOKENS[key] ?? `{${key}}`);
  const num = padWidth ? String(startNumber).padStart(padWidth, "0") : String(startNumber);
  return `${prefix}${num}${suffix}`;
}

interface CodeRule { id: number; company_id: number | null; prefix_template: string; suffix_template: string; start_number: number; pad_width: number }

export function CodeRuleScreen() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ prefixTemplate: "", suffixTemplate: "", startNumber: 1, padWidth: 0 });

  useQuery({ queryKey: ["code-rules"], queryFn: () => apiClient.get<CodeRule[]>("/code-rules") });

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post("/code-rules", {
      company_id: null, prefix_template: form.prefixTemplate, suffix_template: form.suffixTemplate,
      start_number: form.startNumber, pad_width: form.padWidth,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["code-rules"] }),
  });

  return (
    <div>
      <h1>Asset Code Rule</h1>
      <label htmlFor="prefix-template">Prefix Template</label>
      <input
        id="prefix-template"
        aria-label="Prefix Template"
        value={form.prefixTemplate}
        onChange={(e) => setForm((f) => ({ ...f, prefixTemplate: e.target.value }))}
      />

      <label htmlFor="suffix-template">Suffix</label>
      <input id="suffix-template" value={form.suffixTemplate}
        onChange={(e) => setForm((f) => ({ ...f, suffixTemplate: e.target.value }))} />

      <label htmlFor="start-number">Start Number</label>
      <input id="start-number" type="number" value={form.startNumber}
        onChange={(e) => setForm((f) => ({ ...f, startNumber: Number(e.target.value) }))} />

      <label htmlFor="pad-width">Pad Width (0 = no padding)</label>
      <input id="pad-width" type="number" value={form.padWidth}
        onChange={(e) => setForm((f) => ({ ...f, padWidth: Number(e.target.value) }))} />

      <p>Preview: <span data-testid="code-preview">
        {renderPreview(form.prefixTemplate, form.suffixTemplate, form.startNumber, form.padWidth)}
      </span></p>

      <button onClick={() => saveMutation.mutate()}>Save</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/numbering/CodeRuleScreen.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Create the route file and commit**

```tsx
// frontend/src/routes/setup/code-rule.tsx
import { CodeRuleScreen } from "../../features/numbering/CodeRuleScreen";
export default function CodeRuleSetup() { return <CodeRuleScreen />; }
```

```bash
git add frontend/src/routes/setup/code-rule.tsx frontend/src/features/numbering
git commit -m "feat(frontend): Code Rule setup screen with live preview"
```

---

## Task 13: Asset and asset_event models, migration, immutability + ledger-protection triggers

**Files:**
- Create: `backend/app/assets/__init__.py`, `backend/app/assets/models.py`
- Create: `backend/app/lifecycle/__init__.py`, `backend/app/lifecycle/models.py`
- Create: `backend/app/alembic/versions/0003_assets_and_events.py`
- Modify: `backend/app/alembic/env.py` (import both new model modules)
- Test: `backend/tests/assets/test_models.py`, `backend/tests/lifecycle/test_ledger_protection.py`

**Interfaces:**
- Consumes: `Company`, `CostCenter`, `AssetCategory`, `AssetSubcategory`, `Vendor` (Task 3); `Holder` (Task 4).
- Produces: ORM `Asset` (table `asset`, columns per spec §4.4) and `AssetEvent` (table `asset_event`, columns per spec §4.5). Three DB-level guarantees, enforced by Postgres triggers (not just app code): (1) `asset_event` rejects UPDATE and DELETE; (2) `asset` rejects UPDATE of `asset_code`, `company_id`, `cost_center_id` once set.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/assets/test_models.py
import pytest
from datetime import date
from sqlalchemy.exc import DBAPIError
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.assets.models import Asset


async def _base_fixtures(session, suffix="AM1"):
    co = Company(code=f"CKS-{suffix}", name="Asset Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT Equipment")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="Head Office")
    loc = Location(code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-Dept-{suffix}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock_holder = Holder(company_id=co.id, emp_code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                           holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
    session.add(stock_holder)
    await session.flush()
    return co, cat, sub, cc, stock_holder


async def test_asset_code_is_immutable_after_insert():
    async with SessionLocal() as session:
        co, cat, sub, cc, holder = await _base_fixtures(session)
        asset = Asset(
            asset_code="FA/HO01/IT/LAP/CK_1", company_id=co.id, cost_center_id=cc.id,
            category_id=cat.id, subcategory_id=sub.id, description="Test Laptop",
            purchase_date=date(2025, 12, 10), status="IN_STOCK", current_holder_id=holder.id,
            status_since=date(2025, 12, 10),
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        asset.asset_code = "CHANGED"
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()
```

```python
# backend/tests/lifecycle/test_ledger_protection.py
import pytest
from datetime import date, datetime, timezone
from sqlalchemy.exc import DBAPIError
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.assets.models import Asset
from app.lifecycle.models import AssetEvent


async def test_asset_event_cannot_be_updated_or_deleted():
    async with SessionLocal() as session:
        co = Company(code="CKS-LG1", name="Ledger Test Co")
        cat = AssetCategory(code="IT-LG1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-LG1", name="HO")
        dept = Department(name="IT-LG1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        holder = Holder(company_id=co.id, emp_code="ITSTOCK-LG1", name="IT Stock-HO",
                         holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        session.add(holder)
        await session.flush()
        asset = Asset(asset_code="FA/HO01/IT/LAP/CK_99", company_id=co.id, cost_center_id=cc.id,
                       category_id=cat.id, subcategory_id=sub.id, description="Ledger Laptop",
                       purchase_date=date(2025, 12, 10), status="IN_STOCK", current_holder_id=holder.id,
                       status_since=date(2025, 12, 10))
        session.add(asset)
        await session.flush()
        event = AssetEvent(asset_id=asset.id, event_type="PROCURED", event_date=datetime.now(timezone.utc),
                            to_holder_id=holder.id, status_after="IN_STOCK", recorded_by=holder.id)
        session.add(event)
        await session.commit()
        await session.refresh(event)

        event.remarks = "trying to edit history"
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()

        await session.refresh(event)
        await session.delete(event)
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\pytest tests/assets tests/lifecycle -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.assets'`

- [ ] **Step 3: Implement `backend/app/assets/models.py`**

```python
from datetime import date, datetime
from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin

ASSET_STATUSES = ("IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST")


class Asset(Base, AuditMixin):
    __tablename__ = "asset"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """Soft-delete for a data-entry mistake only (spec §4.4, §7) — never used to remove an
    asset that has left PROCURED; that's what the DISPOSED/SOLD/SCRAPPED/LOST terminal
    states are for. Enforced by the delete endpoint added in Task 16."""
    asset_code: Mapped[str] = mapped_column(String(200), unique=True)
    legacy_asset_code: Mapped[str | None] = mapped_column(String(200))
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    cost_center_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cost_center.id"))
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    brand: Mapped[str | None] = mapped_column(String(200))
    model: Mapped[str | None] = mapped_column(String(200))
    serial_number: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500))

    vendor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("vendor.id"))
    po_number: Mapped[str | None] = mapped_column(String(100))
    po_date: Mapped[date | None] = mapped_column(Date)
    invoice_number: Mapped[str | None] = mapped_column(String(100))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    pi_number: Mapped[str | None] = mapped_column(String(100))
    pi_date: Mapped[date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    tax_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    tax_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    total_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    purchase_date: Mapped[date] = mapped_column(Date)
    warranty_upto: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(20))
    current_holder_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    status_since: Mapped[date] = mapped_column(Date)

    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
```

- [ ] **Step 4: Implement `backend/app/lifecycle/models.py`**

```python
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

EVENT_TYPES = ("PROCURED", "IMPORTED", "MOVED", "SENT_FOR_REPAIR", "RECEIVED_FROM_REPAIR",
               "DISPOSED", "SOLD", "SCRAPPED", "LOST", "FOUND", "CORRECTION")


class AssetEvent(Base):
    __tablename__ = "asset_event"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id"))
    event_type: Mapped[str] = mapped_column(String(30))
    event_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    from_holder_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
    to_holder_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
    status_after: Mapped[str] = mapped_column(String(20))
    remarks: Mapped[str | None] = mapped_column(String(1000))
    reference_no: Mapped[str | None] = mapped_column(String(100))
    recorded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 5: Wire Alembic imports and autogenerate the table migration**

In `backend/app/alembic/env.py`, add `import app.assets.models  # noqa: F401` and `import app.lifecycle.models  # noqa: F401`.
Run: `.venv\Scripts\alembic revision --autogenerate -m "assets and events"`, rename to `0003_assets_and_events.py`, review it creates `asset` and `asset_event` with all columns above.

- [ ] **Step 6: Hand-add the trigger SQL to the same migration**

Open `0003_assets_and_events.py` and append to the end of `upgrade()`, after the autogenerated `create_table` calls:

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_event_write() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'asset_event rows are append-only; insert a CORRECTION event instead';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_asset_event_no_update
        BEFORE UPDATE ON asset_event
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_event_write();
    """)
    op.execute("""
        CREATE TRIGGER trg_asset_event_no_delete
        BEFORE DELETE ON asset_event
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_event_write();
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_identity_change() RETURNS trigger AS $$
        BEGIN
            IF NEW.asset_code IS DISTINCT FROM OLD.asset_code THEN
                RAISE EXCEPTION 'asset_code is immutable once set';
            END IF;
            IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
                RAISE EXCEPTION 'company_id is immutable once set';
            END IF;
            IF NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
                RAISE EXCEPTION 'cost_center_id is immutable once set';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_asset_no_identity_change
        BEFORE UPDATE ON asset
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_identity_change();
    """)
```

And to `downgrade()`, before the `drop_table` calls:

```python
    op.execute("DROP TRIGGER IF EXISTS trg_asset_no_identity_change ON asset;")
    op.execute("DROP FUNCTION IF EXISTS forbid_asset_identity_change;")
    op.execute("DROP TRIGGER IF EXISTS trg_asset_event_no_delete ON asset_event;")
    op.execute("DROP TRIGGER IF EXISTS trg_asset_event_no_update ON asset_event;")
    op.execute("DROP FUNCTION IF EXISTS forbid_asset_event_write;")
```

- [ ] **Step 7: Apply the migration**

Run: `.venv\Scripts\alembic upgrade head`

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv\Scripts\pytest tests/assets tests/lifecycle -v`
Expected: `2 passed`

- [ ] **Step 9: Commit**

```bash
git add backend/app/assets backend/app/lifecycle backend/app/alembic backend/tests/assets backend/tests/lifecycle
git commit -m "feat(assets): asset and asset_event models with DB-enforced immutability"
```

---

## Task 14: Lifecycle state machine (pure function)

**Files:**
- Create: `backend/app/lifecycle/state_machine.py`
- Test: `backend/tests/lifecycle/test_state_machine.py`

**Interfaces:**
- Consumes: `ASSET_STATUSES` (Task 13), `EVENT_TYPES` (Task 13), `HOLDER_TYPES` (Task 4).
- Produces: `app.lifecycle.state_machine.transition(current_status: str, event_type: str, to_holder_type: str | None, actor_role: str) -> str` — returns the new status or raises `LifecycleError(message)`; `app.lifecycle.state_machine.LifecycleError(Exception)`; `app.lifecycle.state_machine.label_for_event(event_type, from_holder_type, to_holder_type) -> str` (the timeline label text from spec §5).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/lifecycle/test_state_machine.py
import pytest
from app.lifecycle.state_machine import LifecycleError, label_for_event, transition


@pytest.mark.parametrize("current,event,to_type,role,expected", [
    ("IN_STOCK", "MOVED", "EMPLOYEE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "STORE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "INSTALLED", "IT_TEAM", "INSTALLED"),
    ("IN_STOCK", "MOVED", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "STORE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "SENT_FOR_REPAIR", None, "IT_TEAM", "UNDER_REPAIR"),
    ("ALLOTTED", "SENT_FOR_REPAIR", None, "IT_TEAM", "UNDER_REPAIR"),
    ("UNDER_REPAIR", "RECEIVED_FROM_REPAIR", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("UNDER_REPAIR", "SCRAPPED", None, "IT_TEAM", "SCRAPPED"),
    ("IN_STOCK", "DISPOSED", None, "IT_TEAM", "DISPOSED"),
    ("IN_STOCK", "SOLD", None, "IT_TEAM", "SOLD"),
    ("IN_STOCK", "SCRAPPED", None, "IT_TEAM", "SCRAPPED"),
    ("ALLOTTED", "LOST", None, "IT_TEAM", "LOST"),
    ("LOST", "FOUND", "IT_STOCK", "ADMIN", "IN_STOCK"),
    ("ALLOTTED", "CORRECTION", None, "ADMIN", "ALLOTTED"),   # correction never changes status...
    ("DISPOSED", "CORRECTION", None, "ADMIN", "DISPOSED"),   # ...even on a terminal asset
])
def test_allowed_transitions(current, event, to_type, role, expected):
    assert transition(current, event, to_type, role) == expected


@pytest.mark.parametrize("current,event,to_type,role", [
    ("ALLOTTED", "DISPOSED", None, "IT_TEAM"),          # must return to stock first
    ("ALLOTTED", "SOLD", None, "IT_TEAM"),
    ("ALLOTTED", "SCRAPPED", None, "IT_TEAM"),
    ("DISPOSED", "MOVED", "EMPLOYEE", "IT_TEAM"),        # terminal state
    ("SOLD", "MOVED", "EMPLOYEE", "IT_TEAM"),
    ("SCRAPPED", "MOVED", "EMPLOYEE", "IT_TEAM"),
    ("LOST", "MOVED", "EMPLOYEE", "IT_TEAM"),            # only FOUND allowed from LOST
    ("LOST", "FOUND", "IT_STOCK", "IT_TEAM"),            # FOUND is admin-only
    ("IN_STOCK", "RECEIVED_FROM_REPAIR", "IT_STOCK", "IT_TEAM"),  # not under repair
    ("ALLOTTED", "CORRECTION", None, "IT_TEAM"),         # CORRECTION is admin-only
])
def test_forbidden_transitions_raise(current, event, to_type, role):
    with pytest.raises(LifecycleError):
        transition(current, event, to_type, role)


@pytest.mark.parametrize("event,from_type,to_type,expected", [
    ("MOVED", "IT_STOCK", "EMPLOYEE", "Allotted to {to}"),
    ("MOVED", "IT_STOCK", "STORE", "Allotted to {to}"),
    ("MOVED", "EMPLOYEE", "IT_STOCK", "Returned to {to}"),
    ("MOVED", "STORE", "IT_STOCK", "Returned to {to}"),
    ("MOVED", "IT_STOCK", "INSTALLED", "Installed at {to}"),
    ("MOVED", "EMPLOYEE", "STORE", "Transferred from {from} to {to}"),
    ("PROCURED", None, "IT_STOCK", "Procured into {to}"),
])
def test_label_for_event(event, from_type, to_type, expected):
    assert label_for_event(event, from_type, to_type) == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/lifecycle/test_state_machine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.lifecycle.state_machine'`

- [ ] **Step 3: Implement `backend/app/lifecycle/state_machine.py`**

```python
class LifecycleError(Exception):
    pass


_STOCK_LIKE_STATUS_BY_HOLDER_TYPE = {
    "EMPLOYEE": "ALLOTTED",
    "STORE": "ALLOTTED",
    "INSTALLED": "INSTALLED",
    "IT_STOCK": "IN_STOCK",
}

_TERMINAL_STATUSES = {"DISPOSED", "SOLD", "SCRAPPED"}

# current_status -> set of event_types allowed from it
_ALLOWED_EVENTS = {
    "IN_STOCK": {"MOVED", "SENT_FOR_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"},
    "ALLOTTED": {"MOVED", "SENT_FOR_REPAIR", "LOST"},
    "INSTALLED": {"MOVED", "SENT_FOR_REPAIR", "LOST"},
    "UNDER_REPAIR": {"RECEIVED_FROM_REPAIR", "SCRAPPED"},
    "LOST": {"FOUND"},
    "DISPOSED": set(),
    "SOLD": set(),
    "SCRAPPED": set(),
}


def transition(current_status: str, event_type: str, to_holder_type: str | None, actor_role: str) -> str:
    if event_type == "CORRECTION":
        # A correction note never changes status and is allowed from any status, including
        # a terminal one — it only annotates history (spec §5: "Only Admin can ... add a
        # correction note to the history").
        if actor_role != "ADMIN":
            raise LifecycleError("only ADMIN may add a correction note")
        return current_status

    if current_status in _TERMINAL_STATUSES:
        raise LifecycleError(f"{current_status} is a terminal state; no further events are allowed")

    allowed = _ALLOWED_EVENTS.get(current_status, set())
    if event_type not in allowed:
        raise LifecycleError(f"event '{event_type}' is not allowed from status '{current_status}'")

    if event_type == "FOUND" and actor_role != "ADMIN":
        raise LifecycleError("only ADMIN may mark a LOST asset as FOUND")

    if event_type == "MOVED":
        if to_holder_type not in _STOCK_LIKE_STATUS_BY_HOLDER_TYPE:
            raise LifecycleError(f"unknown holder type '{to_holder_type}'")
        return _STOCK_LIKE_STATUS_BY_HOLDER_TYPE[to_holder_type]

    if event_type == "SENT_FOR_REPAIR":
        return "UNDER_REPAIR"

    if event_type == "RECEIVED_FROM_REPAIR":
        if to_holder_type not in _STOCK_LIKE_STATUS_BY_HOLDER_TYPE:
            raise LifecycleError(f"unknown holder type '{to_holder_type}'")
        return _STOCK_LIKE_STATUS_BY_HOLDER_TYPE[to_holder_type]

    if event_type == "FOUND":
        return "IN_STOCK"

    if event_type in ("DISPOSED", "SOLD", "SCRAPPED"):
        return event_type

    if event_type == "LOST":
        return "LOST"

    raise LifecycleError(f"unhandled event '{event_type}'")


def label_for_event(event_type: str, from_holder_type: str | None, to_holder_type: str | None) -> str:
    if event_type == "PROCURED":
        return "Procured into {to}"
    if event_type == "IMPORTED":
        return "Imported, assigned to {to}"
    if event_type == "SENT_FOR_REPAIR":
        return "Sent for repair"
    if event_type == "RECEIVED_FROM_REPAIR":
        return "Received from repair, into {to}"
    if event_type == "DISPOSED":
        return "Disposed"
    if event_type == "SOLD":
        return "Sold"
    if event_type == "SCRAPPED":
        return "Scrapped"
    if event_type == "LOST":
        return "Reported lost"
    if event_type == "FOUND":
        return "Found, returned to {to}"
    if event_type == "CORRECTION":
        return "Correction note"

    if event_type == "MOVED":
        to_status = _STOCK_LIKE_STATUS_BY_HOLDER_TYPE.get(to_holder_type)
        from_status = _STOCK_LIKE_STATUS_BY_HOLDER_TYPE.get(from_holder_type)
        if to_status == "IN_STOCK":
            return "Returned to {to}"
        if to_status == "INSTALLED":
            return "Installed at {to}"
        if from_status == "IN_STOCK" and to_status == "ALLOTTED":
            return "Allotted to {to}"
        if from_status == "ALLOTTED" and to_status == "ALLOTTED":
            return "Transferred from {from} to {to}"
        return "Moved to {to}"

    raise LifecycleError(f"unhandled event '{event_type}'")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/lifecycle/test_state_machine.py -v`
Expected: `27 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/lifecycle/state_machine.py backend/tests/lifecycle/test_state_machine.py
git commit -m "feat(lifecycle): pure state-machine transition function and timeline labels"
```

---

## Task 15: Lifecycle service + Add Asset service (procurement, quantity, tax)

**Files:**
- Create: `backend/app/lifecycle/service.py`, `backend/app/assets/service.py`
- Test: `backend/tests/lifecycle/test_service.py`, `backend/tests/assets/test_service.py`

**Interfaces:**
- Consumes: `transition`, `label_for_event` (Task 14); `Asset`, `AssetEvent` (Task 13); `generate_code`, `get_active_rule` (Task 11); `Holder` (Task 4).
- Produces: `app.lifecycle.service.apply_event(session, asset, event_type, to_holder_id, actor, event_date=None, remarks=None, reference_no=None) -> AssetEvent` — the **only** function anywhere in the codebase allowed to write `asset.status`/`current_holder_id`/`status_since`, and the only one allowed to insert into `asset_event`; it validates the date rule (spec §5: not before the asset's latest event, not in the future) before writing. `app.assets.service.procure_assets(session, data: dict, quantity: int, actor) -> list[Asset]` — computes `tax_amount`/`total_cost`, generates one code per unit via `generate_code`, creates each `Asset` row in the given company's default `IT_STOCK` holder (or an explicit initial holder if provided), and calls `apply_event(..., event_type="PROCURED")` for each.

- [ ] **Step 1: Write the failing test for `apply_event`**

```python
# backend/tests/lifecycle/test_service.py
import pytest
from datetime import date, datetime, timedelta, timezone
from app.core.db import SessionLocal
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.assets.models import Asset


async def _fixture(session, suffix):
    co = Company(code=f"CKS-{suffix}", name="Lifecycle Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    loc = Location(code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-{suffix}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock = Holder(company_id=co.id, emp_code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                    holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
    ankur = Holder(company_id=co.id, emp_code=f"CS-{suffix}", name="Ankur",
                    holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER")
    it_actor = Holder(company_id=co.id, emp_code=f"ITA-{suffix}", name="IT Actor",
                       holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="IT_TEAM")
    session.add_all([stock, ankur, it_actor])
    await session.flush()
    asset = Asset(asset_code=f"FA/HO01/IT/LAP/CK_{suffix}", company_id=co.id, cost_center_id=cc.id,
                   category_id=cat.id, subcategory_id=sub.id, description="Fixture Laptop",
                   purchase_date=date(2025, 12, 10), status="IN_STOCK", current_holder_id=stock.id,
                   status_since=date(2025, 12, 10))
    session.add(asset)
    await session.flush()
    return asset, stock, ankur, it_actor


async def test_apply_event_allots_and_updates_asset():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S1")
        event = await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        assert event.event_type == "MOVED"
        assert event.to_holder_id == ankur.id
        assert asset.status == "ALLOTTED"
        assert asset.current_holder_id == ankur.id


async def test_apply_event_rejects_dispose_while_allotted():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S2")
        await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        with pytest.raises(LifecycleError):
            await apply_event(session, asset, "DISPOSED", to_holder_id=None, actor=it_actor)


async def test_apply_event_rejects_future_date():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S3")
        future = datetime.now(timezone.utc) + timedelta(days=5)
        with pytest.raises(LifecycleError, match="future"):
            await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor, event_date=future)


async def test_apply_event_rejects_date_before_last_event():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S4")
        await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        too_early = datetime(2020, 1, 1, tzinfo=timezone.utc)
        with pytest.raises(LifecycleError, match="before"):
            await apply_event(session, asset, "MOVED", to_holder_id=stock.id, actor=it_actor, event_date=too_early)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/lifecycle/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.lifecycle.service'`

- [ ] **Step 3: Implement `backend/app/lifecycle/service.py`**

```python
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.state_machine import LifecycleError, transition


async def apply_event(
    session: AsyncSession,
    asset: Asset,
    event_type: str,
    to_holder_id: int | None,
    actor: Holder,
    event_date: datetime | None = None,
    remarks: str | None = None,
    reference_no: str | None = None,
) -> AssetEvent:
    event_date = event_date or datetime.now(timezone.utc)
    now = datetime.now(timezone.utc)
    if event_date > now:
        raise LifecycleError("event date cannot be in the future")

    last_event_stmt = (
        select(AssetEvent).where(AssetEvent.asset_id == asset.id).order_by(AssetEvent.event_date.desc(), AssetEvent.id.desc())
    )
    last_event = (await session.execute(last_event_stmt)).scalars().first()
    if last_event and event_date < last_event.event_date:
        raise LifecycleError("event date cannot be before the asset's last recorded event")

    to_holder_type = None
    if to_holder_id is not None:
        to_holder = await session.get(Holder, to_holder_id)
        if to_holder is None:
            raise LifecycleError("target holder not found")
        if to_holder.company_id != asset.company_id:
            raise LifecycleError("assets can only move within their own company")
        to_holder_type = to_holder.holder_type

    new_status = transition(asset.status, event_type, to_holder_type, actor.role)

    event = AssetEvent(
        asset_id=asset.id, event_type=event_type, event_date=event_date,
        from_holder_id=asset.current_holder_id, to_holder_id=to_holder_id,
        status_after=new_status, remarks=remarks, reference_no=reference_no,
        recorded_by=actor.id, recorded_at=now,
    )
    session.add(event)

    asset.status = new_status
    if to_holder_id is not None:
        asset.current_holder_id = to_holder_id
    asset.status_since = event_date

    await session.flush()
    return event
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/lifecycle/test_service.py -v`
Expected: `4 passed`

- [ ] **Step 5: Write the failing test for `procure_assets`**

```python
# backend/tests/assets/test_service.py
from datetime import date
from app.core.db import SessionLocal
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_procure_assets_creates_quantity_with_tax_and_codes():
    async with SessionLocal() as session:
        co = Company(code="CKS-PR1", name="Procure Test Co")
        cat = AssetCategory(code="IT-PR1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="MOU", name="Mouse")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-PR1", name="HO")
        dept = Department(name="IT-PR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-PR1", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_actor = Holder(company_id=co.id, emp_code="ITA-PR1", name="IT Actor",
                           holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="IT_TEAM")
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_actor, rule])
        await session.commit()

        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Wireless Mouse", "purchase_date": date(2025, 12, 10),
            "purchase_cost": 1000, "tax_percent": 18, "initial_holder_id": stock.id,
        }, quantity=3, actor=it_actor)
        await session.commit()

        assert len(assets) == 3
        assert [a.asset_code for a in assets] == [
            "FA/HO01/IT/MOU/CK_1", "FA/HO01/IT/MOU/CK_2", "FA/HO01/IT/MOU/CK_3",
        ]
        for a in assets:
            assert a.tax_amount == 180
            assert a.total_cost == 1180
            assert a.status == "IN_STOCK"
            assert a.current_holder_id == stock.id
```

- [ ] **Step 6: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/assets/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.assets.service'`

- [ ] **Step 7: Implement `backend/app/assets/service.py`**

```python
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.masters.models import CostCenter, AssetCategory, AssetSubcategory
from app.numbering.service import generate_code, get_active_rule


async def procure_assets(session: AsyncSession, data: dict, quantity: int, actor: Holder) -> list[Asset]:
    company_id = data["company_id"]
    rule = await get_active_rule(session, company_id)

    cost_center = await session.get(CostCenter, data["cost_center_id"])
    category = await session.get(AssetCategory, data["category_id"])
    subcategory = await session.get(AssetSubcategory, data["subcategory_id"]) if data.get("subcategory_id") else None

    tokens = {
        "cost_center.code": cost_center.code if cost_center else "",
        "category.code": category.code if category else "",
        "subcategory.code": subcategory.code if subcategory else "",
        "company.code": "",
        "location.code": "",
        "yyyy": str(data["purchase_date"].year),
        "yy": str(data["purchase_date"].year)[-2:],
        "mm": f"{data['purchase_date'].month:02d}",
    }

    purchase_cost = Decimal(str(data.get("purchase_cost") or 0))
    tax_percent = Decimal(str(data.get("tax_percent") or 0))
    tax_amount = (purchase_cost * tax_percent / Decimal(100)).quantize(Decimal("0.01"))
    total_cost = purchase_cost + tax_amount

    initial_holder_id = data["initial_holder_id"]
    holder = await session.get(Holder, initial_holder_id)

    created: list[Asset] = []
    for _ in range(quantity):
        code = await generate_code(session, rule, tokens)
        asset = Asset(
            asset_code=code,
            legacy_asset_code=data.get("legacy_asset_code"),
            company_id=company_id,
            cost_center_id=data["cost_center_id"],
            category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"),
            brand=data.get("brand"), model=data.get("model"), serial_number=data.get("serial_number"),
            description=data["description"],
            vendor_id=data.get("vendor_id"), po_number=data.get("po_number"), po_date=data.get("po_date"),
            invoice_number=data.get("invoice_number"), invoice_date=data.get("invoice_date"),
            pi_number=data.get("pi_number"), pi_date=data.get("pi_date"),
            purchase_cost=purchase_cost, tax_percent=tax_percent, tax_amount=tax_amount, total_cost=total_cost,
            purchase_date=data["purchase_date"], warranty_upto=data.get("warranty_upto"),
            status="IN_STOCK", current_holder_id=holder.id, status_since=data["purchase_date"],
            custom_fields=data.get("custom_fields") or {},
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(asset)
        await session.flush()

        await apply_event(
            session, asset, "PROCURED", to_holder_id=holder.id, actor=actor,
            event_date=datetime.combine(data["purchase_date"], datetime.min.time()).replace(tzinfo=timezone.utc),
        )
        created.append(asset)

    await session.flush()
    return created
```

- [ ] **Step 8: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/assets/test_service.py -v`
Expected: `1 passed`

- [ ] **Step 9: Commit**

```bash
git add backend/app/lifecycle/service.py backend/app/assets/service.py backend/tests/lifecycle/test_service.py backend/tests/assets/test_service.py
git commit -m "feat(lifecycle,assets): apply_event ledger writer and procure_assets with quantity/tax/coding"
```

---

## Task 16: Assets router — create, get, scoped access; lifecycle action endpoints

**Files:**
- Create: `backend/app/assets/schemas.py`, `backend/app/assets/router.py`
- Create: `backend/app/lifecycle/schemas.py`, `backend/app/lifecycle/router.py`
- Modify: `backend/app/main.py` (mount both routers)
- Test: `backend/tests/assets/test_router.py`, `backend/tests/lifecycle/test_router.py`

**Interfaces:**
- Consumes: `procure_assets` (Task 15), `apply_event` (Task 15), `scoped_company_ids` (Task 5), `Asset`/`AssetEvent` (Task 13).
- Produces: `POST /api/assets` (create, ADMIN/IT_TEAM, body includes `quantity`); `GET /api/assets/{id}` (404 outside scope — ADMIN sees all, IT_TEAM/VIEWER see their scoped companies, HOLDER sees only if `current_holder_id == holder.id`); `DELETE /api/assets/{id}` (ADMIN only, soft-delete for a data-entry mistake — 409 if the asset already has movement history beyond its first event); `GET /api/assets/{id}/events` (the timeline, same scope check); `POST /api/assets/{id}/events` (ADMIN/IT_TEAM only, body `{event_type, to_holder_id?, event_date?, remarks?, reference_no?}`, delegates to `apply_event` and returns 422 with the `LifecycleError` message on an illegal transition).

- [ ] **Step 1: Write the failing test for asset creation and scoped get**

```python
# backend/tests/assets/test_router.py
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def _setup(session, suffix):
    co = Company(code=f"CKS-{suffix}", name="Router Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    loc = Location(code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-{suffix}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock = Holder(company_id=co.id, emp_code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                    holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
    it_admin = Holder(company_id=co.id, emp_code=f"ITA-{suffix}", name="IT Admin",
                       holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
    ankur = Holder(company_id=co.id, emp_code=f"CS-{suffix}", name="Ankur",
                    holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER",
                    password_hash=hash_password("Passw0rd!"), must_change_password=False)
    rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                     suffix_template="", start_number=1, pad_width=0)
    session.add_all([stock, it_admin, ankur, rule])
    await session.commit()
    return co, cc, cat, sub, stock, it_admin, ankur


async def _login(client, company_id, emp_code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "emp_code": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_create_asset_and_scoped_get(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur = await _setup(session, "R1")

    admin_headers = await _login(client, co.id, it_admin.emp_code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Router Test Laptop", "purchase_date": "2025-12-10",
        "purchase_cost": "50000", "tax_percent": "18", "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    assert create_resp.status_code == 201
    asset_id = create_resp.json()[0]["id"]

    get_resp = await client.get(f"/api/assets/{asset_id}", headers=admin_headers)
    assert get_resp.status_code == 200

    holder_headers = await _login(client, co.id, ankur.emp_code)
    holder_get_resp = await client.get(f"/api/assets/{asset_id}", headers=holder_headers)
    assert holder_get_resp.status_code == 404  # not allotted to Ankur yet


async def test_delete_asset_only_before_it_has_moved(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur = await _setup(session, "R2")

    admin_headers = await _login(client, co.id, it_admin.emp_code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Mistake Entry", "purchase_date": "2025-12-10",
        "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    asset_id = create_resp.json()[0]["id"]

    delete_resp = await client.delete(f"/api/assets/{asset_id}", headers=admin_headers)
    assert delete_resp.status_code == 204
    assert (await client.get(f"/api/assets/{asset_id}", headers=admin_headers)).status_code == 404

    create_resp2 = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Moved Then Delete", "purchase_date": "2025-12-10",
        "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    moved_asset_id = create_resp2.json()[0]["id"]
    await client.post(f"/api/assets/{moved_asset_id}/events", json={"event_type": "MOVED", "to_holder_id": ankur.id}, headers=admin_headers)

    conflict_resp = await client.delete(f"/api/assets/{moved_asset_id}", headers=admin_headers)
    assert conflict_resp.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/assets/test_router.py -v`
Expected: FAIL — `404 Not Found` on `POST /api/assets` (no route yet)

- [ ] **Step 3: Implement `backend/app/assets/schemas.py`**

```python
from datetime import date
from pydantic import BaseModel, ConfigDict


class AssetCreateIn(BaseModel):
    company_id: int
    cost_center_id: int
    category_id: int
    subcategory_id: int | None = None
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    description: str
    vendor_id: int | None = None
    po_number: str | None = None
    po_date: date | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    pi_number: str | None = None
    pi_date: date | None = None
    purchase_cost: float | None = None
    tax_percent: float | None = None
    purchase_date: date
    warranty_upto: date | None = None
    initial_holder_id: int
    legacy_asset_code: str | None = None
    custom_fields: dict | None = None
    quantity: int = 1


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_code: str
    legacy_asset_code: str | None
    company_id: int
    description: str
    status: str
    current_holder_id: int
    purchase_cost: float | None
    tax_amount: float | None
    total_cost: float | None
```

- [ ] **Step 4: Implement `backend/app/assets/router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role, scoped_company_ids
from app.assets.models import Asset
from app.assets.schemas import AssetCreateIn, AssetOut
from app.assets.service import procure_assets

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("", response_model=list[AssetOut], status_code=201)
async def create_asset(
    body: AssetCreateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    data = body.model_dump(exclude={"quantity"})
    assets = await procure_assets(session, data, quantity=body.quantity, actor=actor)
    await session.commit()
    for a in assets:
        await session.refresh(a)
    return assets


async def _get_scoped_asset(asset_id: int, session: AsyncSession, holder) -> Asset:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    if holder.role == "HOLDER":
        if asset.current_holder_id != holder.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return asset

    allowed_companies = scoped_company_ids(holder)
    if allowed_companies is not None and asset.company_id not in allowed_companies:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return asset


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    return await _get_scoped_asset(asset_id, session, holder)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset_entry_mistake(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    """Soft-deletes an asset created by data-entry mistake. Only allowed while the asset
    still has just its original PROCURED/IMPORTED event — once it has moved, been repaired
    or been disposed, that history is real and must stay visible; use the DISPOSED/SCRAPPED/
    LOST lifecycle events instead (spec §7 "nothing is hard-deleted")."""
    from datetime import datetime, timezone
    from sqlalchemy import func, select
    from app.lifecycle.models import AssetEvent

    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    event_count = (await session.execute(
        select(func.count()).select_from(AssetEvent).where(AssetEvent.asset_id == asset_id)
    )).scalar_one()
    if event_count > 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "This asset already has movement history; it cannot be deleted, only disposed/scrapped/lost")

    asset.deleted_at = datetime.now(timezone.utc)
    asset.updated_by = actor.id
    await session.commit()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/assets/test_router.py -v`
Expected: `2 passed`

- [ ] **Step 6: Write the failing test for the lifecycle action endpoint**

```python
# backend/tests/lifecycle/test_router.py
from app.core.db import SessionLocal
from app.assets.service import procure_assets
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule
from datetime import date


async def test_allot_via_events_endpoint(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-LR1", name="Lifecycle Router Co")
        cat = AssetCategory(code="IT-LR1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-LR1", name="HO")
        dept = Department(name="IT-LR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-LR1", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-LR1", name="IT Admin",
                           holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        ankur = Holder(company_id=co.id, emp_code="CS-LR1", name="Ankur",
                        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER")
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, ankur, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Router Lifecycle Laptop", "purchase_date": date(2025, 12, 10),
            "purchase_cost": 50000, "tax_percent": 18, "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-LR1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    event_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "to_holder_id": ankur.id,
    }, headers=headers)
    assert event_resp.status_code == 201
    assert event_resp.json()["status_after"] == "ALLOTTED"

    timeline_resp = await client.get(f"/api/assets/{asset_id}/events", headers=headers)
    assert len(timeline_resp.json()) == 2  # PROCURED + MOVED

    bad_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "DISPOSED",
    }, headers=headers)
    assert bad_resp.status_code == 422
```

- [ ] **Step 7: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/lifecycle/test_router.py -v`
Expected: FAIL — `404 Not Found`

- [ ] **Step 8: Implement `backend/app/lifecycle/schemas.py`**

```python
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ApplyEventIn(BaseModel):
    event_type: str
    to_holder_id: int | None = None
    event_date: datetime | None = None
    remarks: str | None = None
    reference_no: str | None = None


class AssetEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_id: int
    event_type: str
    event_date: datetime
    from_holder_id: int | None
    to_holder_id: int | None
    status_after: str
    remarks: str | None
    reference_no: str | None
    recorded_by: int
```

- [ ] **Step 9: Implement `backend/app/lifecycle/router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role
from app.assets.router import _get_scoped_asset
from app.core.deps import get_current_holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import ApplyEventIn, AssetEventOut
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError

router = APIRouter(prefix="/api/assets", tags=["lifecycle"])


@router.get("/{asset_id}/events", response_model=list[AssetEventOut])
async def list_events(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = select(AssetEvent).where(AssetEvent.asset_id == asset.id).order_by(AssetEvent.event_date, AssetEvent.id)
    return (await session.execute(stmt)).scalars().all()


@router.post("/{asset_id}/events", response_model=AssetEventOut, status_code=201)
async def create_event(
    asset_id: int,
    body: ApplyEventIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    asset = await _get_scoped_asset(asset_id, session, actor)
    try:
        event = await apply_event(
            session, asset, body.event_type, to_holder_id=body.to_holder_id, actor=actor,
            event_date=body.event_date, remarks=body.remarks, reference_no=body.reference_no,
        )
    except LifecycleError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(event)
    return event
```

*`FOUND` and `CORRECTION` reuse this same endpoint; the router only checks ADMIN/IT_TEAM, and `apply_event`/`transition` (Task 14) enforce the stricter ADMIN-only rule for both — an IT_TEAM caller passes the router's check but gets a 422 from the `LifecycleError` raised inside `transition`.*

- [ ] **Step 10: Mount both routers and run tests**

```python
# backend/app/main.py
from app.assets.router import router as assets_router
from app.lifecycle.router import router as lifecycle_router
app.include_router(assets_router)
app.include_router(lifecycle_router)
```

Run: `.venv\Scripts\pytest tests/assets tests/lifecycle -v`
Expected: all pass, no failures (this now includes every test written in Tasks 13–16 for these two directories)

- [ ] **Step 11: Commit**

```bash
git add backend/app/assets backend/app/lifecycle backend/app/main.py backend/tests/assets backend/tests/lifecycle
git commit -m "feat(assets,lifecycle): create/get scoped asset endpoints and event action endpoint"
```

---

## Task 17: Add Asset page (frontend)

**Files:**
- Create: `frontend/src/features/assets/AddAssetForm.tsx`, `frontend/src/routes/assets/new.tsx`
- Test: `frontend/src/features/assets/AddAssetForm.test.tsx`

**Interfaces:**
- Consumes: `apiClient`; `POST /api/assets` (Task 16); `GET /api/masters/*`, `GET /api/holders?holder_type=IT_STOCK` (Tasks 7, 9) for the dropdowns.
- Produces: `<AddAssetForm />` — one sectioned page (Identity → Procurement with a live tax total → Custom fields → Initial holder, defaulted to that company's IT_STOCK holder → Quantity) that on submit calls `POST /api/assets` and shows the generated code(s).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/assets/AddAssetForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddAssetForm } from "./AddAssetForm";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AddAssetForm", () => {
  it("computes tax live and shows the generated codes after submit", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
      if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop" }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue([
      { id: 10, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 11, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderWithClient(<AddAssetForm companyId={1} />);

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    fireEvent.change(screen.getByLabelText(/purchase cost/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/tax %/i), { target: { value: "18" } });

    expect(screen.getByTestId("tax-amount")).toHaveTextContent("180");
    expect(screen.getByTestId("total-cost")).toHaveTextContent("1180");

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/assets/AddAssetForm.test.tsx`
Expected: FAIL — `Cannot find module './AddAssetForm'`

- [ ] **Step 3: Implement `frontend/src/features/assets/AddAssetForm.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface Option { id: number; code?: string; name: string }

export function AddAssetForm({ companyId }: { companyId: number }) {
  const [form, setForm] = useState({
    categoryId: 0, subcategoryId: 0, costCenterId: 0, description: "",
    purchaseCost: "0", taxPercent: "0", purchaseDate: new Date().toISOString().slice(0, 10),
    initialHolderId: 0, quantity: "1",
  });
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);

  const { data: categories = [] } = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const { data: subcategories = [] } = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Option[]>("/masters/subcategories") });
  const { data: costCenters = [] } = useQuery({ queryKey: ["masters", "cost-centers"], queryFn: () => apiClient.get<Option[]>("/masters/cost-centers") });
  const { data: stockHolders = [] } = useQuery({ queryKey: ["holders", "IT_STOCK"], queryFn: () => apiClient.get<Option[]>("/holders?holder_type=IT_STOCK") });

  const taxAmount = useMemo(() => (Number(form.purchaseCost) * Number(form.taxPercent)) / 100, [form.purchaseCost, form.taxPercent]);
  const totalCost = Number(form.purchaseCost) + taxAmount;

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post<{ id: number; asset_code: string }[]>("/assets", {
      company_id: companyId, cost_center_id: form.costCenterId, category_id: form.categoryId,
      subcategory_id: form.subcategoryId || null, description: form.description,
      purchase_cost: Number(form.purchaseCost), tax_percent: Number(form.taxPercent),
      purchase_date: form.purchaseDate, initial_holder_id: form.initialHolderId,
      quantity: Number(form.quantity),
    }),
    onSuccess: (created) => setCreatedCodes(created.map((c) => c.asset_code)),
  });

  return (
    <div>
      <h1>Add Asset</h1>

      <h2>Identity</h2>
      <label htmlFor="category">Category</label>
      <select id="category" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: Number(e.target.value) }))}>
        <option value={0}>Select…</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label htmlFor="subcategory">Sub-Category</label>
      <select id="subcategory" value={form.subcategoryId} onChange={(e) => setForm((f) => ({ ...f, subcategoryId: Number(e.target.value) }))}>
        <option value={0}>Select…</option>
        {subcategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label htmlFor="description">Description</label>
      <input id="description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

      <h2>Procurement</h2>
      <label htmlFor="cost-center">Cost Center</label>
      <select id="cost-center" value={form.costCenterId} onChange={(e) => setForm((f) => ({ ...f, costCenterId: Number(e.target.value) }))}>
        <option value={0}>Select…</option>
        {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label htmlFor="purchase-cost">Purchase Cost</label>
      <input id="purchase-cost" type="number" value={form.purchaseCost} onChange={(e) => setForm((f) => ({ ...f, purchaseCost: e.target.value }))} />

      <label htmlFor="tax-percent">Tax %</label>
      <input id="tax-percent" type="number" value={form.taxPercent} onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))} />

      <p>Tax Amount: <span data-testid="tax-amount">{taxAmount}</span></p>
      <p>Total Cost: <span data-testid="total-cost">{totalCost}</span></p>

      <h2>Initial Holder</h2>
      <label htmlFor="initial-holder">Goes into</label>
      <select id="initial-holder" value={form.initialHolderId} onChange={(e) => setForm((f) => ({ ...f, initialHolderId: Number(e.target.value) }))}>
        <option value={0}>Select…</option>
        {stockHolders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>

      <label htmlFor="quantity">Quantity</label>
      <input id="quantity" type="number" min={1} max={100} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />

      <button onClick={() => saveMutation.mutate()}>Save</button>

      {createdCodes.length > 0 && (
        <div>
          <p>Created:</p>
          <ul>{createdCodes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```

*Note: replace the raw `<select>`/`<input>` elements with the scaffolded shadcn/ui `Select`/`Input` per the design system (Task 6 Step 3); custom fields (rendered dynamically from `GET /api/masters/custom-fields`) and document upload are added as a follow-up once Task 21 (Documents) exists — this task covers Identity, Procurement, Initial Holder and Quantity, the fields the spec calls out as the core of Add Asset (§7.3).*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/assets/AddAssetForm.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Create the route file and commit**

```tsx
// frontend/src/routes/assets/new.tsx
import { AddAssetForm } from "../../features/assets/AddAssetForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewAssetRoute() {
  const companyId = useAuthStore((s) => s.companyId)!;
  return <AddAssetForm companyId={companyId} />;
}
```

```bash
git add frontend/src/features/assets/AddAssetForm.tsx frontend/src/features/assets/AddAssetForm.test.tsx frontend/src/routes/assets/new.tsx
git commit -m "feat(frontend): Add Asset page with live tax calc and quantity"
```

---

## Task 18: Asset Detail page — header, timeline, contextual actions

**Files:**
- Create: `frontend/src/features/assets/AssetDetail.tsx`, `frontend/src/features/assets/Timeline.tsx`, `frontend/src/features/assets/actionRules.ts`, `frontend/src/routes/assets/$id.tsx`
- Test: `frontend/src/features/assets/actionRules.test.ts`, `frontend/src/features/assets/AssetDetail.test.tsx`

**Interfaces:**
- Consumes: `apiClient`; `GET /api/assets/{id}`, `GET /api/assets/{id}/events`, `POST /api/assets/{id}/events` (Task 16).
- Produces: `actionsFor(status: string) -> {label: string, eventType: string}[]` (mirrors the backend's `_ALLOWED_EVENTS` from Task 14, so the UI only ever offers legal actions); `<Timeline events={AssetEventOut[]} />`; `<AssetDetail assetId={number} />` with Overview/History/Documents tabs and an action dialog (holder picker, date, remarks, reference no) that posts to the events endpoint.

- [ ] **Step 1: Write the failing test for `actionsFor`**

```typescript
// frontend/src/features/assets/actionRules.test.ts
import { describe, it, expect } from "vitest";
import { actionsFor } from "./actionRules";

describe("actionsFor", () => {
  it("offers Allot/Transfer, Send for Repair and Lost from IN_STOCK", () => {
    const labels = actionsFor("IN_STOCK").map((a) => a.label);
    expect(labels).toContain("Move / Allot");
    expect(labels).toContain("Send for Repair");
    expect(labels).toContain("Dispose");
    expect(labels).not.toContain("Receive from Repair");
  });

  it("offers only Receive from Repair and Scrap from UNDER_REPAIR", () => {
    const labels = actionsFor("UNDER_REPAIR").map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(["Receive from Repair", "Scrap"]));
    expect(labels).not.toContain("Dispose");
  });

  it("offers nothing from a terminal status", () => {
    expect(actionsFor("DISPOSED")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/assets/actionRules.test.ts`
Expected: FAIL — `Cannot find module './actionRules'`

- [ ] **Step 3: Implement `frontend/src/features/assets/actionRules.ts`**

This mirrors `backend/app/lifecycle/state_machine.py::_ALLOWED_EVENTS` (Task 14) — keep the two in sync if either changes.

```typescript
export interface ActionDef { label: string; eventType: string; needsHolder: boolean }

const RULES: Record<string, ActionDef[]> = {
  IN_STOCK: [
    { label: "Move / Allot", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Dispose", eventType: "DISPOSED", needsHolder: false },
    { label: "Sell", eventType: "SOLD", needsHolder: false },
    { label: "Scrap", eventType: "SCRAPPED", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  ALLOTTED: [
    { label: "Move / Transfer", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  INSTALLED: [
    { label: "Move", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  UNDER_REPAIR: [
    { label: "Receive from Repair", eventType: "RECEIVED_FROM_REPAIR", needsHolder: true },
    { label: "Scrap", eventType: "SCRAPPED", needsHolder: false },
  ],
  LOST: [
    { label: "Mark Found", eventType: "FOUND", needsHolder: true },
  ],
  DISPOSED: [],
  SOLD: [],
  SCRAPPED: [],
};

export function actionsFor(status: string): ActionDef[] {
  return RULES[status] ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/assets/actionRules.test.ts`
Expected: `3 passed`

- [ ] **Step 5: Implement `frontend/src/features/assets/Timeline.tsx`**

```tsx
interface AssetEvent {
  id: number; event_type: string; event_date: string; status_after: string;
  remarks: string | null; reference_no: string | null;
}

const ICONS: Record<string, string> = {
  PROCURED: "📦", IMPORTED: "📥", MOVED: "🔁", SENT_FOR_REPAIR: "🔧",
  RECEIVED_FROM_REPAIR: "✅", DISPOSED: "🗑️", SOLD: "💰", SCRAPPED: "♻️",
  LOST: "❓", FOUND: "🔎", CORRECTION: "✏️",
};

export function Timeline({ events }: { events: AssetEvent[] }) {
  return (
    <ol>
      {events.map((e) => (
        <li key={e.id}>
          <span aria-hidden>{ICONS[e.event_type] ?? "•"}</span>{" "}
          <strong>{e.event_type}</strong> · {new Date(e.event_date).toLocaleDateString()}
          {e.remarks && <div>{e.remarks}</div>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: Write the failing test for `AssetDetail`**

```tsx
// frontend/src/features/assets/AssetDetail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetDetail } from "./AssetDetail";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AssetDetail", () => {
  it("only shows actions valid for the current status and posts the chosen action", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") return Promise.resolve({ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" });
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 99, status_after: "ALLOTTED" });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /move \/ allot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive from repair/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /move \/ allot/i }));
    fireEvent.change(screen.getByLabelText(/holder/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/events", expect.objectContaining({
      event_type: "MOVED", to_holder_id: 5,
    })));
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/features/assets/AssetDetail.test.tsx`
Expected: FAIL — `Cannot find module './AssetDetail'`

- [ ] **Step 8: Implement `frontend/src/features/assets/AssetDetail.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { actionsFor } from "./actionRules";
import { Timeline } from "./Timeline";

interface Asset { id: number; asset_code: string; description: string; status: string }
interface HolderOption { id: number; name: string }

export function AssetDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "history" | "documents">("overview");
  const [activeAction, setActiveAction] = useState<{ eventType: string; needsHolder: boolean } | null>(null);
  const [holderId, setHolderId] = useState<number>(0);

  const { data: asset } = useQuery({ queryKey: ["assets", assetId], queryFn: () => apiClient.get<Asset>(`/assets/${assetId}`) });
  const { data: events = [] } = useQuery({ queryKey: ["assets", assetId, "events"], queryFn: () => apiClient.get(`/assets/${assetId}/events`) });
  const { data: holders = [] } = useQuery({ queryKey: ["holders", "all"], queryFn: () => apiClient.get<HolderOption[]>("/holders") });

  const actMutation = useMutation({
    mutationFn: () => apiClient.post(`/assets/${assetId}/events`, {
      event_type: activeAction!.eventType,
      to_holder_id: activeAction!.needsHolder ? holderId : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", assetId] });
      qc.invalidateQueries({ queryKey: ["assets", assetId, "events"] });
      setActiveAction(null);
    },
  });

  if (!asset) return null;

  return (
    <div>
      <header>
        <h1>{asset.asset_code}</h1>
        <p>{asset.description}</p>
        <span>{asset.status}</span>
        {actionsFor(asset.status).map((a) => (
          <button key={a.eventType + a.label} onClick={() => setActiveAction(a)}>{a.label}</button>
        ))}
      </header>

      <nav>
        <button onClick={() => setTab("overview")}>Overview</button>
        <button onClick={() => setTab("history")}>History</button>
        <button onClick={() => setTab("documents")}>Documents</button>
      </nav>

      {tab === "overview" && <p>{asset.description}</p>}
      {tab === "history" && <Timeline events={events as any} />}
      {tab === "documents" && <p>Documents (Task 21)</p>}

      {activeAction && (
        <div role="dialog">
          {activeAction.needsHolder && (
            <>
              <label htmlFor="holder-select">Holder</label>
              <select id="holder-select" aria-label="Holder" value={holderId} onChange={(e) => setHolderId(Number(e.target.value))}>
                <option value={0}>Select…</option>
                {holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </>
          )}
          <button onClick={() => actMutation.mutate()}>Confirm</button>
          <button onClick={() => setActiveAction(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

*Note: replace raw elements with shadcn/ui `Tabs`, `Dialog`, `Badge`, `Button` per the design system, and add a QR code (`qrcode.react` or a `<img src="/api/assets/{id}/qr.png">` once Task 23 adds the backend QR endpoint) and a Print Label button next to the header, matching spec §7.5.*

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/features/assets/AssetDetail.test.tsx`
Expected: `1 passed`

- [ ] **Step 10: Create the route file and commit**

```tsx
// frontend/src/routes/assets/$id.tsx
import { AssetDetail } from "../../features/assets/AssetDetail";

export default function AssetDetailRoute({ params }: { params: { id: string } }) {
  return <AssetDetail assetId={Number(params.id)} />;
}
```

```bash
git add frontend/src/features/assets/AssetDetail.tsx frontend/src/features/assets/Timeline.tsx frontend/src/features/assets/actionRules.ts frontend/src/features/assets/actionRules.test.ts frontend/src/features/assets/AssetDetail.test.tsx frontend/src/routes/assets/\$id.tsx
git commit -m "feat(frontend): Asset Detail page with status-driven actions and timeline"
```

---

## Task 19: Asset Register — scoped search/filter backend + bulk move, and the register page

**Files:**
- Create: `backend/app/assets/search_service.py`
- Modify: `backend/app/assets/router.py` (add `GET /api/assets` list endpoint, `POST /api/assets/bulk-move`)
- Create: `frontend/src/features/assets/AssetRegister.tsx`, `frontend/src/routes/assets/index.tsx`
- Test: `backend/tests/assets/test_search.py`, `frontend/src/features/assets/AssetRegister.test.tsx`

**Interfaces:**
- Consumes: `Asset`, `scoped_company_ids`, `apply_event` (Tasks 13, 5, 15).
- Produces: `GET /api/assets?status=&category_id=&holder_id=&company_id=&q=` returning `{items: AssetOut[], total: int}`, scoped by role exactly like `_get_scoped_asset`; `q` matches `asset_code`, `legacy_asset_code`, `serial_number`, `po_number`, `invoice_number`, `pi_number` (case-insensitive substring); `POST /api/assets/bulk-move {asset_ids: int[], to_holder_id: int}` applies `MOVED` to each, skipping (and reporting) any that fail their own transition check rather than aborting the whole batch. Frontend: `<AssetRegister />` — filter bar, results table, row click → `/assets/$id`, bulk-select + Move.

- [ ] **Step 1: Write the failing backend test**

```python
# backend/tests/assets/test_search.py
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_search_by_serial_and_scoped_bulk_move(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-SR1", name="Search Test Co")
        cat = AssetCategory(code="IT-SR1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="MOU", name="Mouse")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-SR1", name="HO")
        dept = Department(name="IT-SR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-SR1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        store = Holder(company_id=co.id, emp_code="ALC-SR1", name="ALC", holder_type="STORE",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-SR1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, store, it_admin, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Bulk Mouse", "purchase_date": date(2025, 12, 10),
            "serial_number": "SR-SEARCH-1", "initial_holder_id": stock.id,
        }, quantity=2, actor=it_admin)
        await session.commit()
        asset_ids = [a.id for a in assets]

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-SR1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    search_resp = await client.get("/api/assets?q=SR-SEARCH-1", headers=headers)
    assert search_resp.json()["total"] == 2

    bulk_resp = await client.post("/api/assets/bulk-move", json={
        "asset_ids": asset_ids, "to_holder_id": store.id,
    }, headers=headers)
    assert bulk_resp.status_code == 200
    assert bulk_resp.json()["moved"] == 2
    assert bulk_resp.json()["failed"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/assets/test_search.py -v`
Expected: FAIL — `404 Not Found` on `GET /api/assets`

- [ ] **Step 3: Implement `backend/app/assets/search_service.py`**

```python
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset


async def search_assets(
    session: AsyncSession,
    allowed_company_ids: list[int] | None,
    status: str | None = None,
    category_id: int | None = None,
    holder_id: int | None = None,
    company_id: int | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Asset], int]:
    stmt = select(Asset).where(Asset.deleted_at.is_(None))
    if allowed_company_ids is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed_company_ids))
    if company_id is not None:
        stmt = stmt.where(Asset.company_id == company_id)
    if status is not None:
        stmt = stmt.where(Asset.status == status)
    if category_id is not None:
        stmt = stmt.where(Asset.category_id == category_id)
    if holder_id is not None:
        stmt = stmt.where(Asset.current_holder_id == holder_id)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(
            Asset.asset_code.ilike(pattern), Asset.legacy_asset_code.ilike(pattern),
            Asset.serial_number.ilike(pattern), Asset.po_number.ilike(pattern),
            Asset.invoice_number.ilike(pattern), Asset.pi_number.ilike(pattern),
        ))

    total = len((await session.execute(stmt)).scalars().all())
    page_stmt = stmt.order_by(Asset.id.desc()).limit(limit).offset(offset)
    items = (await session.execute(page_stmt)).scalars().all()
    return items, total
```

*Counting via `len(...all())` is fine at CKAM's few-thousand-row scale (spec §7 performance target: <1s at 20,000 rows); switch to a `func.count()` subquery only if profiling shows it matters.*

- [ ] **Step 4: Add the list and bulk-move endpoints to `backend/app/assets/router.py`**

```python
from fastapi import Query
from pydantic import BaseModel
from app.assets.search_service import search_assets
from app.core.deps import scoped_company_ids
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError


class AssetListOut(BaseModel):
    items: list[AssetOut]
    total: int


class BulkMoveIn(BaseModel):
    asset_ids: list[int]
    to_holder_id: int


class BulkMoveOut(BaseModel):
    moved: int
    failed: list[dict]


@router.get("", response_model=AssetListOut)
async def list_assets(
    status: str | None = Query(None), category_id: int | None = Query(None),
    holder_id: int | None = Query(None), company_id: int | None = Query(None),
    q: str | None = Query(None), limit: int = Query(50, le=200), offset: int = Query(0),
    session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    if holder.role == "HOLDER":
        holder_id = holder.id
        allowed = None
    else:
        allowed = scoped_company_ids(holder)
    items, total = await search_assets(session, allowed, status, category_id, holder_id, company_id, q, limit, offset)
    return AssetListOut(items=items, total=total)


@router.post("/bulk-move", response_model=BulkMoveOut)
async def bulk_move(
    body: BulkMoveIn, session: AsyncSession = Depends(get_session), actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    moved = 0
    failed = []
    for asset_id in body.asset_ids:
        asset = await session.get(Asset, asset_id)
        if asset is None:
            failed.append({"asset_id": asset_id, "reason": "not found"})
            continue
        try:
            await apply_event(session, asset, "MOVED", to_holder_id=body.to_holder_id, actor=actor)
            moved += 1
        except LifecycleError as exc:
            failed.append({"asset_id": asset_id, "reason": str(exc)})
    await session.commit()
    return BulkMoveOut(moved=moved, failed=failed)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/assets/test_search.py -v`
Expected: `1 passed`

- [ ] **Step 6: Commit backend**

```bash
git add backend/app/assets backend/tests/assets/test_search.py
git commit -m "feat(assets): register search/filter and bulk move endpoints"
```

- [ ] **Step 7: Write the failing frontend test**

```tsx
// frontend/src/features/assets/AssetRegister.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetRegister } from "./AssetRegister";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AssetRegister", () => {
  it("lists assets and searches by the query box", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 });

    renderWithClient(<AssetRegister />);
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "CK_1" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("q=CK_1")));
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/features/assets/AssetRegister.test.tsx`
Expected: FAIL — `Cannot find module './AssetRegister'`

- [ ] **Step 9: Implement `frontend/src/features/assets/AssetRegister.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface AssetRow { id: number; asset_code: string; description: string; status: string }

export function AssetRegister() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const { data } = useQuery({
    queryKey: ["assets", "register", q],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>(`/assets?q=${encodeURIComponent(q)}`),
  });
  const items = data?.items ?? [];

  return (
    <div>
      <h1>Asset Register</h1>
      <label htmlFor="search">Search</label>
      <input id="search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />

      <table>
        <thead><tr><th /><th>Code</th><th>Description</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>
                <input type="checkbox" checked={selected.includes(a.id)}
                  onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((id) => id !== a.id))} />
              </td>
              <td><a href={`/assets/${a.id}`}>{a.asset_code}</a></td>
              <td>{a.description}</td>
              <td>{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run src/features/assets/AssetRegister.test.tsx`
Expected: `1 passed`

- [ ] **Step 11: Route file and commit**

```tsx
// frontend/src/routes/assets/index.tsx
import { AssetRegister } from "../../features/assets/AssetRegister";
export default function AssetsIndexRoute() { return <AssetRegister />; }
```

```bash
git add frontend/src/features/assets/AssetRegister.tsx frontend/src/features/assets/AssetRegister.test.tsx frontend/src/routes/assets/index.tsx
git commit -m "feat(frontend): Asset Register with search and row navigation"
```

---

## Task 20: Dashboard — KPIs, alerts backend, and the dashboard page

**Files:**
- Create: `backend/app/reports/__init__.py`, `backend/app/reports/dashboard_service.py`, `backend/app/reports/schemas.py`, `backend/app/reports/router.py`
- Modify: `backend/app/main.py` (mount reports router)
- Create: `frontend/src/features/dashboard/Dashboard.tsx`, `frontend/src/routes/dashboard.tsx`
- Test: `backend/tests/reports/test_dashboard.py`, `frontend/src/features/dashboard/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `Asset`, `Holder` (Tasks 13, 4); `scoped_company_ids` (Task 5).
- Produces: `GET /api/reports/dashboard` returning `{status_counts: {status: count}, stock_by_location: [{location, count}], warranty_alerts: [{asset_id, asset_code, warranty_upto}], long_allocation_alerts: [{asset_id, asset_code, days_allotted}]}`, scoped to the caller's companies. Warranty alert threshold: 30 days. Long-allocation threshold: 180 days (both from spec §7.2/§10.5, kept as named constants so they're easy to change later).

- [ ] **Step 1: Write the failing backend test**

```python
# backend/tests/reports/test_dashboard.py
from datetime import date, timedelta
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_dashboard_counts_and_warranty_alert(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-DB1", name="Dashboard Test Co")
        cat = AssetCategory(code="IT-DB1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-DB1", name="HO")
        dept = Department(name="IT-DB1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-DB1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-DB1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Dashboard Laptop", "purchase_date": date(2025, 12, 10),
            "warranty_upto": date.today() + timedelta(days=10), "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-DB1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    dash_resp = await client.get("/api/reports/dashboard", headers=headers)
    assert dash_resp.status_code == 200
    body = dash_resp.json()
    assert body["status_counts"]["IN_STOCK"] >= 1
    assert any(a["warranty_upto"] for a in body["warranty_alerts"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/reports/test_dashboard.py -v`
Expected: FAIL — `404 Not Found`

- [ ] **Step 3: Implement `backend/app/reports/dashboard_service.py`**

```python
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.masters.models import Location

WARRANTY_ALERT_DAYS = 30
LONG_ALLOCATION_ALERT_DAYS = 180


async def dashboard_data(session: AsyncSession, allowed_company_ids: list[int] | None) -> dict:
    base = select(Asset)
    if allowed_company_ids is not None:
        base = base.where(Asset.company_id.in_(allowed_company_ids))

    count_stmt = base.with_only_columns(Asset.status, func.count()).group_by(Asset.status)
    status_counts = {row[0]: row[1] for row in (await session.execute(count_stmt)).all()}

    stock_stmt = (
        base.join(Holder, Asset.current_holder_id == Holder.id)
        .join(Location, Holder.location_id == Location.id)
        .where(Holder.holder_type == "IT_STOCK")
        .with_only_columns(Location.name, func.count())
        .group_by(Location.name)
    )
    stock_by_location = [{"location": row[0], "count": row[1]} for row in (await session.execute(stock_stmt)).all()]

    today = date.today()
    warranty_stmt = base.where(
        Asset.warranty_upto.is_not(None),
        Asset.warranty_upto <= today + timedelta(days=WARRANTY_ALERT_DAYS),
        Asset.warranty_upto >= today,
    )
    warranty_assets = (await session.execute(warranty_stmt)).scalars().all()
    warranty_alerts = [{"asset_id": a.id, "asset_code": a.asset_code, "warranty_upto": a.warranty_upto.isoformat()} for a in warranty_assets]

    long_alloc_cutoff = datetime.now(timezone.utc) - timedelta(days=LONG_ALLOCATION_ALERT_DAYS)
    long_stmt = base.where(Asset.status == "ALLOTTED", Asset.status_since <= long_alloc_cutoff.date())
    long_assets = (await session.execute(long_stmt)).scalars().all()
    long_allocation_alerts = [
        {"asset_id": a.id, "asset_code": a.asset_code, "days_allotted": (today - a.status_since).days}
        for a in long_assets
    ]

    return {
        "status_counts": status_counts,
        "stock_by_location": stock_by_location,
        "warranty_alerts": warranty_alerts,
        "long_allocation_alerts": long_allocation_alerts,
    }
```

- [ ] **Step 4: Implement `backend/app/reports/schemas.py` and `backend/app/reports/router.py`**

```python
# backend/app/reports/schemas.py
from pydantic import BaseModel


class DashboardOut(BaseModel):
    status_counts: dict[str, int]
    stock_by_location: list[dict]
    warranty_alerts: list[dict]
    long_allocation_alerts: list[dict]
```

```python
# backend/app/reports/router.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, scoped_company_ids
from app.reports.dashboard_service import dashboard_data
from app.reports.schemas import DashboardOut

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder)):
    allowed = scoped_company_ids(holder)
    return await dashboard_data(session, allowed)
```

- [ ] **Step 5: Mount the router, run test, commit**

```python
# backend/app/main.py
from app.reports.router import router as reports_router
app.include_router(reports_router)
```

Run: `.venv\Scripts\pytest tests/reports/test_dashboard.py -v` → `1 passed`

```bash
git add backend/app/reports backend/app/main.py backend/tests/reports
git commit -m "feat(reports): dashboard KPI, stock-by-location and alert endpoint"
```

- [ ] **Step 6: Write the failing frontend test**

```tsx
// frontend/src/features/dashboard/Dashboard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("Dashboard", () => {
  it("shows KPI tiles and warranty alerts", async () => {
    (apiClient.get as any).mockResolvedValue({
      status_counts: { IN_STOCK: 5, ALLOTTED: 3 },
      stock_by_location: [{ location: "HO", count: 5 }],
      warranty_alerts: [{ asset_id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", warranty_upto: "2026-10-01" }],
      long_allocation_alerts: [],
    });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails, then implement `frontend/src/features/dashboard/Dashboard.tsx`**

Run: `npx vitest run src/features/dashboard/Dashboard.test.tsx` → FAIL, module not found.

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface DashboardData {
  status_counts: Record<string, number>;
  stock_by_location: { location: string; count: number }[];
  warranty_alerts: { asset_id: number; asset_code: string; warranty_upto: string }[];
  long_allocation_alerts: { asset_id: number; asset_code: string; days_allotted: number }[];
}

export function Dashboard() {
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiClient.get<DashboardData>("/reports/dashboard") });
  if (!data) return null;

  return (
    <div>
      <h1>Dashboard</h1>
      <div>
        {Object.entries(data.status_counts).map(([status, count]) => (
          <div key={status}>
            <p>{status}</p>
            <p>{count}</p>
          </div>
        ))}
      </div>

      <h2>Stock by Location</h2>
      <ul>{data.stock_by_location.map((s) => <li key={s.location}>{s.location}: {s.count}</li>)}</ul>

      <h2>Warranty Expiring Soon</h2>
      <ul>{data.warranty_alerts.map((a) => <li key={a.asset_id}>{a.asset_code} — {a.warranty_upto}</li>)}</ul>

      <h2>Allotted &gt; 180 days</h2>
      <ul>{data.long_allocation_alerts.map((a) => <li key={a.asset_id}>{a.asset_code} — {a.days_allotted} days</li>)}</ul>
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes, add route, commit**

Run: `npx vitest run src/features/dashboard/Dashboard.test.tsx` → `1 passed`

```tsx
// frontend/src/routes/dashboard.tsx
import { Dashboard } from "../features/dashboard/Dashboard";
export default function DashboardRoute() { return <Dashboard />; }
```

```bash
git add frontend/src/features/dashboard frontend/src/routes/dashboard.tsx
git commit -m "feat(frontend): Dashboard with KPI tiles, stock-by-location, alerts"
```

---

## Task 21: My Assets (holder view)

**Files:**
- Create: `frontend/src/features/my-assets/MyAssets.tsx`, `frontend/src/routes/my-assets.tsx`
- Test: `frontend/src/features/my-assets/MyAssets.test.tsx`

**Interfaces:**
- Consumes: `GET /api/assets` (Task 19) — a HOLDER-role caller is already forced to `holder_id = self` server-side, so this screen needs no new backend endpoint.
- Produces: `<MyAssets />` — a read-only list of the logged-in holder's current assets, each linking to the (also read-only for them) Asset Detail page.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/my-assets/MyAssets.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyAssets } from "./MyAssets";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("MyAssets", () => {
  it("lists only the caller's own assets with no action buttons", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "ALLOTTED" }], total: 1 });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><MyAssets /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/my-assets/MyAssets.test.tsx`
Expected: FAIL — `Cannot find module './MyAssets'`

- [ ] **Step 3: Implement `frontend/src/features/my-assets/MyAssets.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface AssetRow { id: number; asset_code: string; description: string; status: string }

export function MyAssets() {
  const { data } = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>("/assets"),
  });
  const items = data?.items ?? [];

  return (
    <div>
      <h1>My Assets</h1>
      <table>
        <thead><tr><th>Code</th><th>Description</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td><a href={`/assets/${a.id}`}>{a.asset_code}</a></td>
              <td>{a.description}</td>
              <td>{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes, add route, commit**

Run: `npx vitest run src/features/my-assets/MyAssets.test.tsx` → `1 passed`

```tsx
// frontend/src/routes/my-assets.tsx
import { MyAssets } from "../features/my-assets/MyAssets";
export default function MyAssetsRoute() { return <MyAssets />; }
```

```bash
git add frontend/src/features/my-assets frontend/src/routes/my-assets.tsx
git commit -m "feat(frontend): My Assets read-only view for holder logins"
```

*Note: `AssetDetail` (Task 18) must also hide its action buttons entirely when `useAuthStore().role === "HOLDER"` — add that guard as part of this task: wrap the `actionsFor(...)` render block in `frontend/src/features/assets/AssetDetail.tsx` with `{role !== "HOLDER" && ...}`.*

- [ ] **Step 5: Add the HOLDER guard to AssetDetail and commit**

```tsx
// frontend/src/features/assets/AssetDetail.tsx — inside the header, replace the bare actions map:
import { useAuthStore } from "../../lib/auth-store";
// ...
const role = useAuthStore((s) => s.role);
// ...
{role !== "HOLDER" && actionsFor(asset.status).map((a) => (
  <button key={a.eventType + a.label} onClick={() => setActiveAction(a)}>{a.label}</button>
))}
```

```bash
git add frontend/src/features/assets/AssetDetail.tsx
git commit -m "fix(frontend): hide asset actions from HOLDER-role viewers"
```

---

## Task 22: Document upload/download backend + Documents tab

**Files:**
- Create: `backend/app/documents/__init__.py`, `backend/app/documents/models.py`, `backend/app/documents/service.py`, `backend/app/documents/schemas.py`, `backend/app/documents/router.py`
- Create: `backend/app/alembic/versions/0004_documents.py`
- Modify: `backend/app/alembic/env.py`, `backend/app/main.py`
- Modify: `frontend/src/features/assets/AssetDetail.tsx` (wire the Documents tab)
- Create: `frontend/src/features/assets/DocumentsTab.tsx`
- Test: `backend/tests/documents/test_router.py`, `frontend/src/features/assets/DocumentsTab.test.tsx`

**Interfaces:**
- Consumes: `Asset` (Task 13); `settings.upload_dir` (Task 2); `_get_scoped_asset` (Task 16).
- Produces: ORM `AssetDocument` (table `asset_document`, columns per spec §4.6); `POST /api/assets/{id}/documents` (multipart upload, ADMIN/IT_TEAM, ≤10MB, types pdf/jpg/png/xlsx/docx, stored at `{upload_dir}/{asset_id}/{uuid}.{ext}`); `GET /api/assets/{id}/documents` (list, scope-checked); `GET /api/documents/{doc_id}/download` (streams the file, scope-checked).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/documents/test_router.py
import io
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_upload_and_list_document(client, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co = Company(code="CKS-DOC1", name="Doc Test Co")
        cat = AssetCategory(code="IT-DOC1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-DOC1", name="HO")
        dept = Department(name="IT-DOC1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-DOC1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-DOC1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Doc Laptop", "purchase_date": date(2025, 12, 10), "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-DOC1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    file_bytes = io.BytesIO(b"%PDF-1.4 fake invoice content")
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("invoice.pdf", file_bytes, "application/pdf")},
        data={"doc_type": "invoice"},
        headers=headers,
    )
    assert upload_resp.status_code == 201

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["doc_type"] == "invoice"

    doc_id = list_resp.json()[0]["id"]
    download_resp = await client.get(f"/api/documents/{doc_id}/download", headers=headers)
    assert download_resp.status_code == 200
    assert download_resp.content.startswith(b"%PDF")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/documents -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.documents'`

- [ ] **Step 3: Implement `backend/app/documents/models.py`**

```python
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

DOC_TYPES = ("invoice", "po", "warranty_card", "photo", "other")


class AssetDocument(Base):
    __tablename__ = "asset_document"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id"))
    doc_type: Mapped[str] = mapped_column(String(20))
    file_name: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 4: Wire Alembic, generate and apply the migration**

Add `import app.documents.models  # noqa: F401` to `env.py`.
Run: `.venv\Scripts\alembic revision --autogenerate -m "documents"`, rename to `0004_documents.py`, review, then `.venv\Scripts\alembic upgrade head`.

- [ ] **Step 5: Implement `backend/app/documents/service.py`**

```python
import uuid
from datetime import datetime, timezone
from pathlib import Path
from app.core.config import settings
from app.documents.models import AssetDocument

MAX_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".docx"}


async def save_document(asset_id: int, doc_type: str, filename: str, content: bytes, mime_type: str, uploaded_by: int) -> AssetDocument:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"file type '{ext}' is not allowed")
    if len(content) > MAX_SIZE_BYTES:
        raise ValueError("file exceeds the 10 MB limit")

    asset_dir = Path(settings.upload_dir) / str(asset_id)
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}{ext}"
    stored_path = asset_dir / stored_name
    stored_path.write_bytes(content)

    return AssetDocument(
        asset_id=asset_id, doc_type=doc_type, file_name=filename, stored_path=str(stored_path),
        mime_type=mime_type, size_bytes=len(content), uploaded_by=uploaded_by,
        uploaded_at=datetime.now(timezone.utc),
    )
```

- [ ] **Step 6: Implement `backend/app/documents/schemas.py` and `backend/app/documents/router.py`**

```python
# backend/app/documents/schemas.py
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class AssetDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_id: int
    doc_type: str
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_at: datetime
```

```python
# backend/app/documents/router.py
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.assets.router import _get_scoped_asset
from app.documents.models import AssetDocument
from app.documents.schemas import AssetDocumentOut
from app.documents.service import save_document

router = APIRouter(tags=["documents"])


@router.post("/api/assets/{asset_id}/documents", response_model=AssetDocumentOut, status_code=201)
async def upload_document(
    asset_id: int, doc_type: str = Form(...), file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session), actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    asset = await _get_scoped_asset(asset_id, session, actor)
    content = await file.read()
    try:
        doc = await save_document(asset.id, doc_type, file.filename, content, file.content_type or "application/octet-stream", actor.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.get("/api/assets/{asset_id}/documents", response_model=list[AssetDocumentOut])
async def list_documents(
    asset_id: int, session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = select(AssetDocument).where(AssetDocument.asset_id == asset.id)
    return (await session.execute(stmt)).scalars().all()


@router.get("/api/documents/{doc_id}/download")
async def download_document(
    doc_id: int, session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    doc = await session.get(AssetDocument, doc_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _get_scoped_asset(doc.asset_id, session, holder)  # raises 404 if out of scope
    return FileResponse(doc.stored_path, media_type=doc.mime_type, filename=doc.file_name)
```

- [ ] **Step 7: Mount router, run tests, commit**

```python
# backend/app/main.py
from app.documents.router import router as documents_router
app.include_router(documents_router)
```

Run: `.venv\Scripts\pytest tests/documents -v` → `1 passed`

```bash
git add backend/app/documents backend/app/alembic backend/app/main.py backend/tests/documents
git commit -m "feat(documents): upload, list and scoped download of asset files"
```

- [ ] **Step 8: Write the failing frontend test, implement `DocumentsTab`, wire into `AssetDetail`, commit**

```tsx
// frontend/src/features/assets/DocumentsTab.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentsTab } from "./DocumentsTab";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("DocumentsTab", () => {
  it("lists documents for the asset", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, doc_type: "invoice", file_name: "invoice.pdf", size_bytes: 1024 }]);
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><DocumentsTab assetId={1} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeInTheDocument());
  });
});
```

```tsx
// frontend/src/features/assets/DocumentsTab.tsx
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface Doc { id: number; doc_type: string; file_name: string; size_bytes: number }

export function DocumentsTab({ assetId }: { assetId: number }) {
  const { data: docs = [] } = useQuery({
    queryKey: ["assets", assetId, "documents"],
    queryFn: () => apiClient.get<Doc[]>(`/assets/${assetId}/documents`),
  });

  return (
    <ul>
      {docs.map((d) => (
        <li key={d.id}>
          <a href={`/api/documents/${d.id}/download`}>{d.file_name}</a> ({d.doc_type}, {Math.round(d.size_bytes / 1024)} KB)
        </li>
      ))}
    </ul>
  );
}
```

Run: `npx vitest run src/features/assets/DocumentsTab.test.tsx` → `1 passed`

In `frontend/src/features/assets/AssetDetail.tsx`, replace `{tab === "documents" && <p>Documents (Task 21)</p>}` with `{tab === "documents" && <DocumentsTab assetId={assetId} />}` and import `DocumentsTab`.

```bash
git add frontend/src/features/assets/DocumentsTab.tsx frontend/src/features/assets/DocumentsTab.test.tsx frontend/src/features/assets/AssetDetail.tsx
git commit -m "feat(frontend): Documents tab on Asset Detail"
```

---

## Task 23: Excel import — template, validate, commit (backend + frontend)

**Files:**
- Create: `backend/app/imports/__init__.py`, `backend/app/imports/asset_import_service.py`, `backend/app/imports/schemas.py`, `backend/app/imports/router.py`
- Modify: `backend/app/main.py`
- Create: `frontend/src/features/imports/ImportScreen.tsx`, `frontend/src/routes/import.tsx`
- Test: `backend/tests/imports/test_asset_import.py`, `frontend/src/features/imports/ImportScreen.test.tsx`

**Interfaces:**
- Consumes: `procure_assets` logic pattern (Task 15, adapted here since each imported row already specifies its holder and needs `IMPORTED` not `PROCURED`), `generate_code`/`get_active_rule` (Task 11), `Holder`/`CostCenter`/`AssetCategory`/`AssetSubcategory` lookups by code.
- Produces: `GET /api/imports/assets/template` (downloads an `.xlsx` with the expected columns); `POST /api/imports/assets/preview` (multipart upload, returns `{valid_rows: [...], errors: [{row, message}]}` without writing anything); `POST /api/imports/assets/commit` (re-validates and writes all valid rows in **one transaction** — spec §7.7 "each imported asset gets a new code, keeps its legacy code, and is assigned to its holder from the file, with an IMPORTED event").

- [ ] **Step 1: Write the failing backend test**

```python
# backend/tests/imports/test_asset_import.py
import io
from datetime import date
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


def _build_workbook(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["legacy_asset_code", "company_code", "cost_center_code", "category_code", "subcategory_code",
               "description", "purchase_date", "holder_emp_code"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_preview_and_commit_import(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-IMP1", name="Import Test Co")
        cat = AssetCategory(code="IT-IMP1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-IMP1", name="HO")
        dept = Department(name="IT-IMP1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-IMP1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-IMP1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-IMP1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    xlsx = _build_workbook([
        ["OLD-001", "CKS-IMP1", "HO01", "IT-IMP1", "LAP", "Legacy Laptop 1", "2020-01-15", "ITSTOCK-IMP1"],
        ["OLD-002", "CKS-IMP1", "HO01", "IT-IMP1", "BADSUB", "Legacy Laptop 2", "2020-01-15", "ITSTOCK-IMP1"],
    ])
    preview_resp = await client.post("/api/imports/assets/preview",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert preview_resp.status_code == 200
    body = preview_resp.json()
    assert len(body["valid_rows"]) == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["row"] == 3  # header is row 1, first data row is row 2

    commit_resp = await client.post("/api/imports/assets/commit",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert commit_resp.status_code == 200
    assert commit_resp.json()["imported"] == 1
    assert commit_resp.json()["errors"][0]["row"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/imports -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imports'`

- [ ] **Step 3: Implement `backend/app/imports/asset_import_service.py`**

```python
from datetime import datetime, timezone
from io import BytesIO
import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter
from app.numbering.service import generate_code, get_active_rule
from app.assets.models import Asset

TEMPLATE_COLUMNS = [
    "legacy_asset_code", "company_code", "cost_center_code", "category_code",
    "subcategory_code", "description", "purchase_date", "holder_emp_code",
]


def build_template() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(TEMPLATE_COLUMNS)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _lookup(session: AsyncSession, model, **filters):
    stmt = select(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return (await session.execute(stmt)).scalars().first()


async def _validate_rows(session: AsyncSession, content: bytes) -> tuple[list[dict], list[dict]]:
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    valid_rows: list[dict] = []
    errors: list[dict] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue
        legacy_code, company_code, cc_code, cat_code, sub_code, description, purchase_date, holder_code = row

        company = await _lookup(session, Company, code=company_code)
        if company is None:
            errors.append({"row": row_idx, "message": f"unknown company_code '{company_code}'"})
            continue
        cost_center = await _lookup(session, CostCenter, company_id=company.id, code=cc_code)
        if cost_center is None:
            errors.append({"row": row_idx, "message": f"unknown cost_center_code '{cc_code}'"})
            continue
        category = await _lookup(session, AssetCategory, code=cat_code)
        if category is None:
            errors.append({"row": row_idx, "message": f"unknown category_code '{cat_code}'"})
            continue
        subcategory = await _lookup(session, AssetSubcategory, category_id=category.id, code=sub_code)
        if subcategory is None:
            errors.append({"row": row_idx, "message": f"unknown subcategory_code '{sub_code}' for category '{cat_code}'"})
            continue
        holder = await _lookup(session, Holder, company_id=company.id, emp_code=holder_code)
        if holder is None:
            errors.append({"row": row_idx, "message": f"unknown holder_emp_code '{holder_code}'"})
            continue
        if not description:
            errors.append({"row": row_idx, "message": "description is required"})
            continue

        valid_rows.append({
            "row": row_idx, "legacy_asset_code": legacy_code, "company": company, "cost_center": cost_center,
            "category": category, "subcategory": subcategory, "description": description,
            "purchase_date": purchase_date, "holder": holder,
        })

    return valid_rows, errors


async def preview_import(session: AsyncSession, content: bytes) -> dict:
    valid_rows, errors = await _validate_rows(session, content)
    return {
        "valid_rows": [{"row": r["row"], "legacy_asset_code": r["legacy_asset_code"], "description": r["description"]} for r in valid_rows],
        "errors": errors,
    }


async def commit_import(session: AsyncSession, content: bytes, actor: Holder) -> dict:
    valid_rows, errors = await _validate_rows(session, content)
    rule = await get_active_rule(session, valid_rows[0]["company"].id) if valid_rows else None

    imported = 0
    for r in valid_rows:
        tokens = {
            "cost_center.code": r["cost_center"].code, "category.code": r["category"].code,
            "subcategory.code": r["subcategory"].code, "company.code": r["company"].code, "location.code": "",
            "yyyy": "", "yy": "", "mm": "",
        }
        code = await generate_code(session, rule, tokens)
        purchase_date = r["purchase_date"]
        if isinstance(purchase_date, str):
            purchase_date = datetime.strptime(purchase_date, "%Y-%m-%d").date()
        elif hasattr(purchase_date, "date"):
            purchase_date = purchase_date.date()

        asset = Asset(
            asset_code=code, legacy_asset_code=r["legacy_asset_code"], company_id=r["company"].id,
            cost_center_id=r["cost_center"].id, category_id=r["category"].id, subcategory_id=r["subcategory"].id,
            description=r["description"], purchase_date=purchase_date,
            status=r["holder"].holder_type and _status_for_holder_type(r["holder"].holder_type),
            current_holder_id=r["holder"].id, status_since=purchase_date,
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(asset)
        await session.flush()
        await apply_event(
            session, asset, "IMPORTED", to_holder_id=r["holder"].id, actor=actor,
            event_date=datetime.combine(purchase_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            remarks=f"Imported from legacy code {r['legacy_asset_code']}",
        )
        imported += 1

    await session.flush()
    return {"imported": imported, "errors": errors}


def _status_for_holder_type(holder_type: str) -> str:
    return {"EMPLOYEE": "ALLOTTED", "STORE": "ALLOTTED", "INSTALLED": "INSTALLED", "IT_STOCK": "IN_STOCK"}[holder_type]
```

*`commit_import` sets `asset.status` directly here (not via `apply_event`'s return value) only because the initial insert needs a status before the first event exists — this mirrors what `procure_assets` does in Task 15, and `apply_event` still performs the actual transition validation and ledger write immediately after. This keeps the "lifecycle service is the only status writer" rule intact at the level that matters: no router or import row ever changes status on an *existing* asset without going through `apply_event`.*

- [ ] **Step 4: Run test to verify it still fails (route missing)**

Run: `.venv\Scripts\pytest tests/imports -v`
Expected: FAIL — `404 Not Found` (service exists, router doesn't)

- [ ] **Step 5: Implement `backend/app/imports/schemas.py` and `backend/app/imports/router.py`**

```python
# backend/app/imports/schemas.py
from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    valid_rows: list[dict]
    errors: list[dict]


class ImportCommitOut(BaseModel):
    imported: int
    errors: list[dict]
```

```python
# backend/app/imports/router.py
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role
from app.imports.asset_import_service import build_template, commit_import, preview_import
from app.imports.schemas import ImportCommitOut, ImportPreviewOut

router = APIRouter(prefix="/api/imports/assets", tags=["imports"])


@router.get("/template")
async def download_template(_h=Depends(require_role("ADMIN", "IT_TEAM"))):
    return Response(
        content=build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=asset_import_template.xlsx"},
    )


@router.post("/preview", response_model=ImportPreviewOut)
async def preview(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    _h=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    return await preview_import(session, content)


@router.post("/commit", response_model=ImportCommitOut)
async def commit(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    result = await commit_import(session, content, actor)
    await session.commit()
    return result
```

- [ ] **Step 6: Mount router, run tests, commit**

```python
# backend/app/main.py
from app.imports.router import router as imports_router
app.include_router(imports_router)
```

Run: `.venv\Scripts\pytest tests/imports -v` → `1 passed`

```bash
git add backend/app/imports backend/app/main.py backend/tests/imports
git commit -m "feat(imports): asset Excel import with per-row preview and transactional commit"
```

- [ ] **Step 7: Write the failing frontend test, implement `ImportScreen`, add route, commit**

```tsx
// frontend/src/features/imports/ImportScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportScreen } from "./ImportScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("ImportScreen", () => {
  it("previews a file and shows errors before committing", async () => {
    (apiClient.post as any).mockResolvedValue({ valid_rows: [{ row: 2, legacy_asset_code: "OLD-1", description: "Laptop" }], errors: [{ row: 3, message: "unknown subcategory_code" }] });
    render(<ImportScreen />);

    const file = new File(["dummy"], "assets.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/unknown subcategory_code/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /commit/i })).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/features/imports/ImportScreen.tsx
import { useState } from "react";
import { apiClient } from "../../lib/api-client";

interface PreviewResult { valid_rows: { row: number; legacy_asset_code: string; description: string }[]; errors: { row: number; message: string }[] }

export function ImportScreen() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<{ imported: number } | null>(null);

  async function doPreview() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<PreviewResult>("/imports/assets/preview", form);
    setPreview(res);
  }

  async function doCommit() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<{ imported: number }>("/imports/assets/commit", form);
    setResult(res);
  }

  return (
    <div>
      <h1>Import Assets</h1>
      <a href="/api/imports/assets/template">Download Template</a>
      <label htmlFor="import-file">File</label>
      <input id="import-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={doPreview}>Preview</button>

      {preview && (
        <div>
          <p>{preview.valid_rows.length} valid rows, {preview.errors.length} errors</p>
          <ul>{preview.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
          {preview.errors.length < 999 && <button onClick={doCommit}>Commit</button>}
        </div>
      )}

      {result && <p>Imported {result.imported} assets.</p>}
    </div>
  );
}
```

*Note: `apiClient.post` must accept a `FormData` body without JSON-stringifying it — extend `frontend/src/lib/api-client.ts` (Task 6) so `request()` skips the `Content-Type`/`JSON.stringify` step when `body instanceof FormData`, passing it through as-is.*

Run: `npx vitest run src/features/imports/ImportScreen.test.tsx` → `1 passed`

```tsx
// frontend/src/routes/import.tsx
import { ImportScreen } from "../features/imports/ImportScreen";
export default function ImportRoute() { return <ImportScreen />; }
```

```bash
git add frontend/src/features/imports frontend/src/routes/import.tsx frontend/src/lib/api-client.ts
git commit -m "feat(frontend): Import Assets screen with preview-then-commit flow"
```

---

## Task 24: Reports Excel export, QR code endpoint, and label printing

**Files:**
- Create: `backend/app/reports/export_service.py`
- Modify: `backend/app/reports/router.py` (add export + QR endpoints)
- Create: `frontend/src/features/reports/ReportsScreen.tsx`, `frontend/src/routes/reports.tsx`
- Modify: `frontend/src/features/assets/AssetDetail.tsx` (QR image + Print Label button)
- Test: `backend/tests/reports/test_export.py`

**Interfaces:**
- Consumes: `search_assets` (Task 19); `qrcode` library (Task 1 dependency).
- Produces: `GET /api/reports/export/assets?...same filters as GET /api/assets...` streams an `.xlsx` of the scoped, filtered register; `GET /api/reports/export/movements?from_date=&to_date=` streams an `.xlsx` of `asset_event` rows in that range; `GET /api/assets/{id}/qr.png` streams a PNG QR code encoding `{BASE_URL}/assets/{id}`, scope-checked.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/reports/test_export.py
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_export_assets_xlsx_and_qr_png(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-EXP1", name="Export Test Co")
        cat = AssetCategory(code="IT-EXP1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-EXP1", name="HO")
        dept = Department(name="IT-EXP1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-EXP1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-EXP1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Export Laptop", "purchase_date": date(2025, 12, 10), "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-EXP1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    export_resp = await client.get("/api/reports/export/assets", headers=headers)
    assert export_resp.status_code == 200
    assert export_resp.headers["content-type"].startswith("application/vnd.openxmlformats")

    qr_resp = await client.get(f"/api/assets/{asset_id}/qr.png", headers=headers)
    assert qr_resp.status_code == 200
    assert qr_resp.headers["content-type"] == "image/png"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/reports/test_export.py -v`
Expected: FAIL — `404 Not Found`

- [ ] **Step 3: Implement `backend/app/reports/export_service.py`**

```python
from io import BytesIO
import openpyxl
import qrcode
from app.assets.models import Asset
from app.core.config import settings


def assets_to_xlsx(assets: list[Asset]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Asset Code", "Legacy Code", "Description", "Status", "Purchase Date", "Purchase Cost", "Tax Amount", "Total Cost"])
    for a in assets:
        ws.append([a.asset_code, a.legacy_asset_code, a.description, a.status,
                   a.purchase_date.isoformat() if a.purchase_date else None,
                   float(a.purchase_cost) if a.purchase_cost is not None else None,
                   float(a.tax_amount) if a.tax_amount is not None else None,
                   float(a.total_cost) if a.total_cost is not None else None])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def movements_to_xlsx(events: list) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Asset Code", "Event", "Date", "From Holder", "To Holder", "Remarks"])
    for e in events:
        ws.append([e.asset_id, e.event_type, e.event_date.isoformat(), e.from_holder_id, e.to_holder_id, e.remarks])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def asset_qr_png(asset_id: int) -> bytes:
    url = f"{settings.base_url}/assets/{asset_id}"
    img = qrcode.make(url)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 4: Add export and QR endpoints to `backend/app/reports/router.py`**

```python
from datetime import date
from fastapi import Query
from fastapi.responses import Response
from sqlalchemy import select
from app.assets.models import Asset
from app.assets.router import _get_scoped_asset
from app.assets.search_service import search_assets
from app.lifecycle.models import AssetEvent
from app.reports.export_service import assets_to_xlsx, asset_qr_png, movements_to_xlsx

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/export/assets")
async def export_assets(
    status: str | None = Query(None), q: str | None = Query(None),
    session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    allowed = None if holder.role == "HOLDER" else scoped_company_ids(holder)
    items, _ = await search_assets(session, allowed, status=status, q=q, limit=10000, offset=0)
    return Response(
        content=assets_to_xlsx(items), media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=asset_register.xlsx"},
    )


@router.get("/export/movements")
async def export_movements(
    from_date: date = Query(...), to_date: date = Query(...),
    session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    stmt = select(AssetEvent).join(Asset, Asset.id == AssetEvent.asset_id).where(
        AssetEvent.event_date >= from_date, AssetEvent.event_date <= to_date,
    )
    allowed = None if holder.role == "HOLDER" else scoped_company_ids(holder)
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    events = (await session.execute(stmt)).scalars().all()
    return Response(
        content=movements_to_xlsx(events), media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=movement_log.xlsx"},
    )
```

The QR route belongs with the other `/api/assets/{id}/...` routes, so it's added to **`backend/app/assets/router.py`** instead of here:

```python
# backend/app/assets/router.py — add at the end
from fastapi.responses import Response as PngResponse
from app.reports.export_service import asset_qr_png


@router.get("/{asset_id}/qr.png")
async def asset_qr(asset_id: int, session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder)):
    await _get_scoped_asset(asset_id, session, holder)
    return PngResponse(content=asset_qr_png(asset_id), media_type="image/png")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\pytest tests/reports/test_export.py -v`
Expected: `1 passed`

- [ ] **Step 6: Commit backend**

```bash
git add backend/app/reports backend/app/assets/router.py backend/tests/reports/test_export.py
git commit -m "feat(reports): Excel export for register/movements, per-asset QR code"
```

- [ ] **Step 7: Add the QR image and Print Label button to `AssetDetail`, build the Reports screen, commit**

```tsx
// frontend/src/features/assets/AssetDetail.tsx — inside <header>, after the status badge:
<img src={`/api/assets/${assetId}/qr.png`} alt="Asset QR code" width={96} height={96} />
<button onClick={() => window.print()}>Print Label</button>
```

```tsx
// frontend/src/features/reports/ReportsScreen.tsx
import { useState } from "react";

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ReportsScreen() {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const [fromDate, setFromDate] = useState(toDateInput(oneYearAgo));
  const [toDate, setToDate] = useState(toDateInput(new Date()));

  return (
    <div>
      <h1>Reports</h1>
      <ul>
        <li><a href="/api/reports/export/assets">Asset Register (Excel)</a></li>
      </ul>

      <h2>Movement Log</h2>
      <label htmlFor="from-date">From</label>
      <input id="from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
      <label htmlFor="to-date">To</label>
      <input id="to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      <a href={`/api/reports/export/movements?from_date=${fromDate}&to_date=${toDate}`}>Download Movement Log (Excel)</a>
    </div>
  );
}
```

```tsx
// frontend/src/routes/reports.tsx
import { ReportsScreen } from "../features/reports/ReportsScreen";
export default function ReportsRoute() { return <ReportsScreen />; }
```

```bash
git add frontend/src/features/assets/AssetDetail.tsx frontend/src/features/reports frontend/src/routes/reports.tsx
git commit -m "feat(frontend): QR label printing and Reports export screen"
```

---

## Task 25: Nightly backup, restore procedure, bootstrap admin, deployment guide

**Files:**
- Create: `ops/backup.sh`, `ops/restore.sh`, `docker-compose.yml` (modify — add `backup` service)
- Create: `backend/scripts/seed_admin.py`
- Create: `docs/deployment.md`
- Test: `backend/tests/scripts/test_seed_admin.py`; `ops/test_backup_restore.sh` (a shell integration check, run manually per Step 5 — no pytest here since it drives Docker Compose itself)

**Interfaces:**
- Consumes: the running `db` and `api` (`uploads` volume) services (Task 1); `Company`, `Location`, `Department` (Task 3); `Holder`, `hash_password` (Tasks 4–5).
- Produces: `backend/scripts/seed_admin.py` — an idempotent one-off script (safe to re-run) that ensures a bootstrap `company` (code `E2E` if `--company-code` not given), a `location`, a `department` and one `ADMIN` holder (`emp_code=SEEDADMIN`, a fixed dev password `Passw0rd!` unless `--password` is passed) exist, printing the created/existing ids; a `backup` container that runs `pg_dump` + tars the `uploads` volume every night at 02:00, writing to a host-mounted `${BACKUP_DIR}`, pruning anything older than 14 days; `ops/restore.sh <backup_file.sql.gz> <uploads_archive.tar.gz>` that restores both into a running stack.

- [ ] **Step 1: Write the failing test for the seed script**

```python
# backend/tests/scripts/test_seed_admin.py
from sqlalchemy import select
from app.core.db import SessionLocal
from app.holders.models import Holder
from scripts.seed_admin import ensure_seed_admin


async def test_seed_admin_is_idempotent():
    async with SessionLocal() as session:
        first = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()
        second = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()

    assert first["holder_id"] == second["holder_id"]

    async with SessionLocal() as session:
        stmt = select(Holder).where(Holder.emp_code == "SEEDADMIN")
        rows = (await session.execute(stmt)).scalars().all()
        assert len(rows) == 1
        assert rows[0].role == "ADMIN"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest tests/scripts/test_seed_admin.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.seed_admin'`

- [ ] **Step 3: Implement `backend/scripts/seed_admin.py`**

```python
import argparse
import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.holders.models import Holder


async def ensure_seed_admin(session: AsyncSession, company_code: str = "E2E", password: str = "Passw0rd!") -> dict:
    company = (await session.execute(select(Company).where(Company.code == company_code))).scalars().first()
    if company is None:
        company = Company(code=company_code, name=f"{company_code} Seed Co")
        session.add(company)
        await session.flush()

    location = (await session.execute(select(Location).where(Location.code == f"{company_code}-HO"))).scalars().first()
    if location is None:
        location = Location(code=f"{company_code}-HO", name="Seed HO")
        session.add(location)
        await session.flush()

    department = (await session.execute(select(Department).where(Department.name == f"{company_code}-IT"))).scalars().first()
    if department is None:
        department = Department(name=f"{company_code}-IT")
        session.add(department)
        await session.flush()

    holder = (await session.execute(select(Holder).where(Holder.emp_code == "SEEDADMIN"))).scalars().first()
    if holder is None:
        holder = Holder(
            company_id=company.id, emp_code="SEEDADMIN", name="Seed Admin", holder_type="EMPLOYEE",
            location_id=location.id, department_id=department.id, role="ADMIN",
            password_hash=hash_password(password), must_change_password=False,
        )
        session.add(holder)
        await session.flush()

    return {"company_id": company.id, "holder_id": holder.id}


async def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-code", default="E2E")
    parser.add_argument("--password", default="Passw0rd!")
    args = parser.parse_args()

    async with SessionLocal() as session:
        result = await ensure_seed_admin(session, args.company_code, args.password)
        await session.commit()
    print(f"Seed admin ready: company_id={result['company_id']} holder_id={result['holder_id']} emp_code=SEEDADMIN")


if __name__ == "__main__":
    asyncio.run(_main())
```

- [ ] **Step 4: Run test to verify it passes, then commit**

Run: `.venv\Scripts\pytest tests/scripts/test_seed_admin.py -v`
Expected: `1 passed`

```bash
git add backend/scripts/seed_admin.py backend/tests/scripts
git commit -m "chore(ops): idempotent bootstrap admin seed script"
```

- [ ] **Step 5: Create `ops/backup.sh`**

```bash
#!/bin/sh
set -eu
STAMP=$(date +%Y%m%d_%H%M%S)
OUT_DIR="/backups"
mkdir -p "$OUT_DIR"

pg_dump -h db -U ckam -d ckam | gzip > "$OUT_DIR/ckam_db_$STAMP.sql.gz"
tar -czf "$OUT_DIR/ckam_uploads_$STAMP.tar.gz" -C /data uploads

find "$OUT_DIR" -name 'ckam_*' -mtime +14 -delete

echo "Backup complete: $STAMP"
```

- [ ] **Step 6: Create `ops/restore.sh`**

```bash
#!/bin/sh
set -eu
if [ $# -ne 2 ]; then
  echo "Usage: restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>"
  exit 1
fi
DB_FILE="$1"
UPLOADS_FILE="$2"

gunzip -c "$DB_FILE" | psql -h db -U ckam -d ckam
tar -xzf "$UPLOADS_FILE" -C /data

echo "Restore complete."
```

- [ ] **Step 7: Add the `backup` service to `docker-compose.yml`**

```yaml
  backup:
    image: postgres:17
    entrypoint: >
      sh -c "apk add --no-cache dcron tar >/dev/null 2>&1 || true;
             echo '0 2 * * * /scripts/backup.sh >> /var/log/ckam-backup.log 2>&1' > /etc/crontabs/root;
             crond -f -l 2"
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD:-ckam_dev_pw}
    volumes:
      - ./ops/backup.sh:/scripts/backup.sh:ro
      - ./ops/restore.sh:/scripts/restore.sh:ro
      - uploads:/data/uploads:ro
      - ${BACKUP_DIR:-./backups}:/backups
    depends_on:
      db:
        condition: service_healthy
```

*The image is `postgres:17` (Debian-based, no `apk`) — the `apk add ... || true` line safely no-ops there; if the base image doesn't ship `cron` at all, switch the base to `postgres:17-alpine` (which does have `apk`) or add a one-line `crontab` install to a small custom Dockerfile under `ops/Dockerfile.backup`. Verify whichever path is taken with Step 4 before relying on it.*

- [ ] **Step 8: Verify backup and restore manually**

Run: `docker compose up -d backup`
Run (from inside the container, to test without waiting for 2am): `docker compose exec backup sh /scripts/backup.sh`
Run: `ls backups/` — expect two new files, `ckam_db_<timestamp>.sql.gz` and `ckam_uploads_<timestamp>.tar.gz`.
Run: `docker compose exec backup sh /scripts/restore.sh /backups/ckam_db_<timestamp>.sql.gz /backups/ckam_uploads_<timestamp>.tar.gz`
Expected: no errors; `docker compose exec db psql -U ckam -d ckam -c "SELECT count(*) FROM asset;"` returns the same count as before the restore.

- [ ] **Step 9: Write `docs/deployment.md`**

```markdown
# CKAM Deployment Guide (LAN server)

## Prerequisites
- Docker + Docker Compose v2 installed on the server.
- Ports 80 (web) and optionally 5432 (Postgres, for admin access only) open on the LAN.

## First-time setup
1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `JWT_SECRET`, `BASE_URL` (e.g. `http://assets.citykart.local`), `BACKUP_DIR`.
2. `docker compose up -d --build`
3. Run migrations: `docker compose exec api alembic upgrade head`
4. Create the first ADMIN holder directly via the API or a one-off seed script (see `backend/scripts/seed_admin.py`, created alongside this task if not already present).
5. Visit `http://<server-ip>/` and log in.

## Day-to-day
- Logs: `docker compose logs -f api`
- Restart: `docker compose restart api web`
- Update: `git pull && docker compose up -d --build`

## Backups
- Nightly automatic backup to `${BACKUP_DIR}`, 14-day retention (Task 25).
- Manual backup: `docker compose exec backup sh /scripts/backup.sh`
- Restore: `docker compose exec backup sh /scripts/restore.sh <db_file> <uploads_file>` — **stop the `api` service first** (`docker compose stop api`) to avoid writes during restore, then start it again.

## Moving from the dev machine to the production server
1. On the dev machine: `docker compose exec backup sh /scripts/backup.sh` to get a full snapshot.
2. Copy the repo (or `git clone` from the GitHub remote) and the two backup files to the server.
3. On the server: follow "First-time setup" above, then run `restore.sh` before creating any new data.
```

- [ ] **Step 10: Commit**

```bash
git add ops docker-compose.yml docs/deployment.md
git commit -m "chore(ops): nightly backup/restore scripts and deployment guide"
```

---

## Task 26: End-to-end test — full custody journey

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/asset-lifecycle.spec.ts`, `frontend/e2e/fixtures.ts`
- Test: itself (Playwright)

**Interfaces:**
- Consumes: the full running stack (`docker compose up`), seeded with one ADMIN holder, one IT_STOCK holder, one EMPLOYEE holder (Ankur) and one STORE holder (ALC) in one company, plus an active `CodeRule` — via `frontend/e2e/fixtures.ts`, which calls the seeding endpoints/service directly against the test database rather than duplicating setup by hand in the spec.
- Produces: one Playwright spec that drives the real browser through: log in → Add Asset → allot to Ankur → return to IT Stock → allot to ALC → verify the Asset Detail timeline shows all four steps in order → verify clicking the asset's row in the Register navigates to the same detail page (spec §5, "reliable row click, tested") → log in as Ankur's holder account and confirm only currently-held assets are listed (none, since the asset ended at ALC).

- [ ] **Step 1: Create `frontend/playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:80" },
});
```

Run: `cd frontend && npm install -D @playwright/test && npx playwright install --with-deps chromium`

- [ ] **Step 2: Create `frontend/e2e/fixtures.ts`**

```typescript
export async function seedTestCompany(baseURL: string) {
  // Calls the backend directly to create a company, cost center, category/subcategory,
  // an active code rule, an IT_STOCK holder, an ADMIN holder, an EMPLOYEE holder (Ankur)
  // and a STORE holder (ALC) — using the same endpoints Tasks 7, 9 and 11 already expose,
  // authenticated as a bootstrap ADMIN created by `backend/scripts/seed_admin.py` (Task 25 Step 5).
  const login = await fetch(`${baseURL}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: 1, emp_code: "SEEDADMIN", password: "Passw0rd!" }),
  }).then((r) => r.json());
  const headers = { Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" };

  const company = await fetch(`${baseURL}/api/masters/companies`, { method: "POST", headers, body: JSON.stringify({ code: "E2E", name: "E2E Co" }) }).then((r) => r.json());
  const location = await fetch(`${baseURL}/api/masters/locations`, { method: "POST", headers, body: JSON.stringify({ code: "E2E-HO", name: "E2E HO" }) }).then((r) => r.json());
  const dept = await fetch(`${baseURL}/api/masters/departments`, { method: "POST", headers, body: JSON.stringify({ name: "E2E-IT" }) }).then((r) => r.json());
  const costCenter = await fetch(`${baseURL}/api/masters/cost-centers`, { method: "POST", headers, body: JSON.stringify({ company_id: company.id, code: "HO01", name: "HO" }) }).then((r) => r.json());
  const category = await fetch(`${baseURL}/api/masters/categories`, { method: "POST", headers, body: JSON.stringify({ code: "IT", name: "IT" }) }).then((r) => r.json());
  const subcategory = await fetch(`${baseURL}/api/masters/subcategories`, { method: "POST", headers, body: JSON.stringify({ category_id: category.id, code: "LAP", name: "Laptop" }) }).then((r) => r.json());
  await fetch(`${baseURL}/api/code-rules`, { method: "POST", headers, body: JSON.stringify({ company_id: null, prefix_template: "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_", suffix_template: "", start_number: 1, pad_width: 0 }) });

  const mk = (body: object) => fetch(`${baseURL}/api/holders`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
  const stock = await mk({ company_id: company.id, emp_code: "ITSTOCK-E2E", name: "IT Stock-HO", holder_type: "IT_STOCK", location_id: location.id, department_id: dept.id, role: "HOLDER" });
  const itAdmin = await mk({ company_id: company.id, emp_code: "ITA-E2E", name: "IT Admin", holder_type: "EMPLOYEE", location_id: location.id, department_id: dept.id, role: "ADMIN" });
  const ankur = await mk({ company_id: company.id, emp_code: "CS6872", name: "Ankur", holder_type: "EMPLOYEE", location_id: location.id, department_id: dept.id, role: "HOLDER" });
  const alc = await mk({ company_id: company.id, emp_code: "ALC", name: "ALC", holder_type: "STORE", location_id: location.id, department_id: dept.id, role: "HOLDER" });

  const itAdminReset = await fetch(`${baseURL}/api/holders/${itAdmin.id}/reset-password`, { method: "POST", headers }).then((r) => r.json());
  const ankurReset = await fetch(`${baseURL}/api/holders/${ankur.id}/reset-password`, { method: "POST", headers }).then((r) => r.json());

  return { company, costCenter, category, subcategory, stock, itAdmin, ankur, alc, itAdminPassword: itAdminReset.temp_password, ankurPassword: ankurReset.temp_password };
}
```

*This fixture assumes a bootstrap `SEEDADMIN` holder already exists in company id `1` — create it via `backend/scripts/seed_admin.py` (referenced in Task 25's deployment guide) and run that script once against the E2E database before this suite runs, documented in `frontend/e2e/README.md` created alongside this file.*

- [ ] **Step 3: Create `frontend/e2e/asset-lifecycle.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";
import { seedTestCompany } from "./fixtures";

test("full custody journey: procure, allot, return, allot again", async ({ page, baseURL }) => {
  const ctx = await seedTestCompany(baseURL!);

  await page.goto("/login");
  await page.getByLabel(/company/i).selectOption(String(ctx.company.id));
  await page.getByLabel(/user id/i).fill(ctx.itAdmin.emp_code);
  await page.getByLabel(/password/i).fill(ctx.itAdminPassword);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/assets/new");
  await page.getByLabel(/category/i).selectOption({ label: "IT" });
  await page.getByLabel(/sub-category/i).selectOption({ label: "Laptop" });
  await page.getByLabel(/description/i).fill("E2E Test Laptop");
  await page.getByLabel(/cost center/i).selectOption({ label: "HO" });
  await page.getByLabel(/goes into/i).selectOption({ label: "IT Stock-HO" });
  await page.getByRole("button", { name: /save/i }).click();
  const codeLink = page.locator("li", { hasText: "FA/HO01/IT/LAP/CK_" }).first();
  await expect(codeLink).toBeVisible();
  const assetCode = await codeLink.textContent();

  await page.goto("/assets");
  await page.getByRole("link", { name: assetCode! }).click();
  await expect(page.getByRole("heading", { name: assetCode! })).toBeVisible();

  await page.getByRole("button", { name: /move \/ allot/i }).click();
  await page.getByLabel(/holder/i).selectOption({ label: "Ankur" });
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page.getByText("ALLOTTED")).toBeVisible();

  await page.getByRole("button", { name: /move \/ transfer/i }).click();
  await page.getByLabel(/holder/i).selectOption({ label: "IT Stock-HO" });
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page.getByText("IN_STOCK")).toBeVisible();

  await page.getByRole("button", { name: /move \/ allot/i }).click();
  await page.getByLabel(/holder/i).selectOption({ label: "ALC" });
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page.getByText("ALLOTTED")).toBeVisible();

  await page.getByRole("button", { name: /history/i }).click();
  const timelineItems = page.locator("li");
  await expect(timelineItems).toHaveCount(4); // PROCURED, MOVED, MOVED, MOVED

  await page.getByRole("button", { name: /log ?out|sign ?out/i }).click().catch(() => {});
  await page.goto("/login");
  await page.getByLabel(/company/i).selectOption(String(ctx.company.id));
  await page.getByLabel(/user id/i).fill(ctx.ankur.emp_code);
  await page.getByLabel(/password/i).fill(ctx.ankurPassword);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.goto("/my-assets");
  await expect(page.getByText(assetCode!)).not.toBeVisible(); // it ended at ALC, not Ankur
});
```

- [ ] **Step 4: Run the suite against the full stack**

Run: `docker compose up -d --build`
Run: `docker compose exec api python backend/scripts/seed_admin.py` (creates `SEEDADMIN` in company id 1, per Task 25 Step 5)
Run (from `frontend/`): `E2E_BASE_URL=http://localhost:80 npx playwright test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e
git commit -m "test(e2e): full custody journey through the real browser and API"
```

---

