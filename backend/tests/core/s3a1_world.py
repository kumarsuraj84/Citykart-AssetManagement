"""Shared set-up for the S3a-1 tests (in-flow creation of small masters,
work-area ownership of Category / Sub-category / Item, stock rooms,
capabilities): the S0 world plus a Non-IT-only admin and a self-service login,
and one Item in each work area."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.items.models import Item
from app.masters.models import Location
from tests.core.s0_world import PASSWORD, build_world, login  # noqa: F401  (re-exported)

# Every kind of login the S3a-1 rules tell apart.
ROLES = ("owner", "admin", "admin_it", "admin_nonit", "op_it", "op_nonit", "viewer_it", "self")


async def build_s3_world() -> dict:
    w = await build_world()
    async with SessionLocal() as s:
        loc_b = (await s.execute(select(Location.id).where(Location.company_id == w["co_b"]))).scalar_one()
        extra = {
            "admin_nonit": AssetUser(company_id=w["co"], code="S3ADMNI", name="Non-IT Admin", asset_user_type="EMPLOYEE",
                                     location_id=w["loc"], role="ADMIN", allowed_asset_domains="NON_IT", login_enabled=True,
                                     password_hash=hash_password(PASSWORD), must_change_password=False),
            "self": AssetUser(company_id=w["co"], code="S3SELF", name="Self Service", asset_user_type="EMPLOYEE",
                              location_id=w["loc"], role="SELF_SERVICE", login_enabled=True,
                              password_hash=hash_password(PASSWORD), must_change_password=False),
            "op_b": AssetUser(company_id=w["co_b"], code="S3OPB", name="Company B Operator", asset_user_type="EMPLOYEE",
                              location_id=loc_b, role="OPERATOR", login_enabled=True,
                              password_hash=hash_password(PASSWORD), must_change_password=False),
        }
        s.add_all(extra.values())
        laptop = Item(name="Laptop", category_id=w["it"], subcategory_id=w["lap"])
        chair = Item(name="Office Chair", category_id=w["nonit"], subcategory_id=w["chair"])
        s.add_all([laptop, chair])
        await s.commit()
        for key, user in extra.items():
            w[key] = user.id
            w["codes"][key] = user.code
        w["item_it"], w["item_nonit"] = laptop.id, chair.id
    return w


def item_body(w: dict, area: str = "it", **over) -> dict:
    body = {"name": "New Item", "category_id": w["it"] if area == "it" else w["nonit"],
            "subcategory_id": w["lap"] if area == "it" else w["chair"]}
    body.update(over)
    return body
