"""S6 cleanups: the unused app-settings reader is gone (its table stays), and `primary_asset_domain` is kept for
API compatibility (still accepted, validated and returned; no rule reads it)."""
import importlib.util

from app.core.db import Base
from app.core.models import AppSetting
from tests.core.s0_world import build_world, login


def test_the_unused_app_settings_reader_is_gone_but_its_table_is_kept():
    assert importlib.util.find_spec("app.core.app_settings") is None
    assert AppSetting.__tablename__ == "app_setting" and "app_setting" in Base.metadata.tables


async def test_primary_asset_domain_still_round_trips_and_does_not_decide_access(client):
    w = await build_world()
    h = await login(client, w, "owner")
    resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"primary_asset_domain": "NON_IT"})
    assert resp.status_code == 200 and resp.json()["primary_asset_domain"] == "NON_IT"
    assert (await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"primary_asset_domain": "MARS"})).status_code == 422
    caps = (await client.get("/api/auth/capabilities", headers=await login(client, w, "op_it"))).json()
    assert caps["work_areas"] == ["IT"]                    # access still comes from allowed_asset_domains only
