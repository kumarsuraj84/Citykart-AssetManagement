"""WP-B local simulation: seed the throw-away ckam_rs database with the S0/S4 test world, connected as the role in
DATABASE_URL (the pre-split runtime role that still owns everything, like production today)."""
import asyncio
import json

from sqlalchemy import text

import app.main  # noqa: F401  (registers every ORM model, as the running app does)
from app.core.db import SessionLocal
from tests.purchase_orders.s4_world import build_s4_world


async def main() -> None:
    async with SessionLocal() as s:
        who = (await s.execute(text("select current_user, current_database()"))).one()
    print(f"connected as {who[0]} to {who[1]}")
    w = await build_s4_world()
    with open("/tmp/rs_world.json", "w") as fh:
        json.dump(w, fh)
    print("seeded: company", w["co"], "stock", w["stock"], "employee", w["employee"], "item_chair", w["item_chair"],
          "owner login", w["codes"]["owner"])


asyncio.run(main())
