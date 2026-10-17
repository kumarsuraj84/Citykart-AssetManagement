# READ-ONLY: list audit_log rows (action/time/actor only) and the auth_session row ages. No secrets printed.
import asyncio, re
import asyncpg
env = {}
for line in open(r"D:\Citykart_Applications\Citykart_AssetManagement_App\shared\.env", encoding="utf-8").read().splitlines():
    m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
    if m:
        env[m.group(1)] = m.group(2)
dsn = env["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://", 1)

async def main():
    c = await asyncpg.connect(dsn)
    try:
        await c.execute("SET default_transaction_read_only = on")
        cols = [r["column_name"] for r in await c.fetch("select column_name from information_schema.columns where table_schema='public' and table_name='audit_log' order by ordinal_position")]
        print("audit_log columns:", ", ".join(cols))
        pick = [x for x in cols if x in ("id", "created_at", "ts", "action", "entity_type", "entity_type_name", "table_name", "actor_id", "actor_user_id", "asset_user_id", "ip", "ip_address", "entity_id")]
        order = "created_at" if "created_at" in cols else "id"
        for r in await c.fetch(f"select {', '.join(pick)} from audit_log order by {order}"):
            print("  ", " | ".join(f"{k}={v}" for k, v in dict(r).items()))
        for r in await c.fetch("select id, asset_user_id, created_at, last_used_at, expires_at, revoked_at, revoked_reason from auth_session"):
            print("auth_session:", dict(r))
    finally:
        await c.close()
asyncio.run(main())
