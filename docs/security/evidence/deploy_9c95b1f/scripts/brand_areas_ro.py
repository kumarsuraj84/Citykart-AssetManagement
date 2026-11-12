"""READ-ONLY: what the brand migration did on CKAM's own production database. Read-only transaction; prints master names and counts only."""
import asyncio, os
import asyncpg

QUERIES = [
    ("alembic head", "select version_num from alembic_version"),
    ("brands by Used for", "select array_to_string(work_areas, '+') areas, count(*) from brand group by 1 order by 1"),
    ("IT only", "select name from brand where work_areas = array['IT']::varchar[] order by name"),
    ("Non-IT only", "select name from brand where work_areas = array['NON_IT']::varchar[] order by name"),
    ("both (used nowhere yet, or by both areas)", "select name from brand where work_areas = array['IT','NON_IT']::varchar[] order by name"),
    ("Items whose default brand does not fit its work area (must be 0)",
     "select count(*) from item i join asset_category c on c.id=i.category_id join brand b on b.id=i.default_brand_id where not (c.asset_domain = any(b.work_areas))"),
    ("brands / Items with a default brand (unchanged: 38 / 46 before)", "select (select count(*) from brand), (select count(*) from item where default_brand_id is not null)"),
]


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://"), timeout=20)
    try:
        async with conn.transaction(readonly=True):
            for title, sql in QUERIES:
                print("==", title)
                for row in await conn.fetch(sql):
                    print("  ", tuple(row.values()))
    finally:
        await conn.close()

asyncio.run(main())
