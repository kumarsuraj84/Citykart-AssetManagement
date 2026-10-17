# READ-ONLY review of CKAM's own user table with the app's own database login (read from shared\.env in this process only).
# Prints no password, hash, token or connection string. Runs inside a READ ONLY transaction.
import asyncio, re, sys
import asyncpg

env = {}
for line in open(r"D:\Citykart_Applications\Citykart_AssetManagement_App\shared\.env", encoding="utf-8").read().splitlines():
    m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
    if m:
        env[m.group(1)] = m.group(2)
dsn = env["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://", 1)

SECRETISH = re.compile(r"pass|hash|secret|token|salt", re.I)

async def main():
    c = await asyncpg.connect(dsn)
    try:
        await c.execute("SET default_transaction_read_only = on")
        for table in ("asset_user", "auth_session"):
            cols = [r["column_name"] for r in await c.fetch(
                "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", table)]
            safe = [x for x in cols if not SECRETISH.search(x)]
            print(f"== {table}: columns shown: {', '.join(safe)}")
            n = await c.fetchval(f"select count(*) from {table}")
            print(f"   rows: {n}")
            if table == "asset_user":
                for r in await c.fetch("select " + ", ".join(f'"{x}"' for x in safe) + " from asset_user order by 1 limit 20"):
                    print("   " + " | ".join(f"{k}={v}" for k, v in dict(r).items()
                                            if k in ("id", "role", "is_active", "created_at", "updated_at", "last_login_at", "last_login", "company_id", "token_version", "employee_code", "must_change_password")))
        print("== recent system/audit event counts")
        for t in ("audit_log", "system_event", "asset_event", "asset", "purchase_order"):
            try:
                print(f"   {t}: {await c.fetchval(f'select count(*) from {t}')}")
            except Exception as e:
                print(f"   {t}: n/a ({type(e).__name__})")
        try:
            rows = await c.fetch("select component, event, level, count(*) n, min(ts) first, max(ts) last from system_event group by 1,2,3 order by n desc limit 12")
            print("== system_event summary")
            for r in rows:
                print("   ", dict(r))
        except Exception as e:
            print("   system_event summary n/a:", type(e).__name__)
    finally:
        await c.close()

asyncio.run(main())
