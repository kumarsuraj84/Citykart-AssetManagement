"""S7 fix round (P1-3): ERP Item suggestions no longer claim "100% match" for a generic overlap.

The UAT saw GANG BOX PVC 4X4 (Article FA_CE_CAMERA PVC BOX) and R-51 HOP BOX (Article FA_CE_HOPBOX) both
suggested as "AI BOX (100% match)" -- AI BOX's only 3+ letter word is BOX -- while the Item HOPBOX existed.
One scoring now (app.items.suggest) for the PO review, the ERP inbox, the Articles screen and Link assets."""
from types import SimpleNamespace

from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.source import ErpItem
from app.items.models import Item, ItemMap
from app.items.service import suggest_item
from app.items.suggest import SUGGESTION_THRESHOLD, ItemMatcher, compact, is_generic
from app.masters.models import AssetCategory, AssetSubcategory
from tests.erp.s3a2_world import bs_po, build_s3a2_world
from tests.erp.test_erp_api import _headers, erp, line  # noqa: F401  (erp is a fixture)


def items(*names):
    return [SimpleNamespace(id=n, name=name) for n, name in enumerate(names, start=1)]


UAT_ITEMS = items("AI BOX", "HOPBOX", "CAMERA", "Network Switch", "UPS", "Cable", "Office Chair", "Gondola Rack 4ft",
                  "LAPTOP", "Desktop", "Dell Desktop")


def best(texts, pool=UAT_ITEMS):
    return ItemMatcher(pool).best(texts)


def name_of(found):
    return found.item.name if found is not None else None


# ------------------------------------------------------------------ the scoring itself

def test_gang_box_pvc_is_not_ai_box():
    texts = ["FA_CE_CAMERA PVC BOX", "FA_CE_CAMERA PVC BOX", "GANG BOX PVC 4X4", "GANG BOX PVC 4X4"]
    assert best(texts) is None
    matcher = ItemMatcher(UAT_ITEMS)
    assert matcher.score(UAT_ITEMS[0], texts) is None                          # AI BOX: only "box" in common


def test_r51_hop_box_is_hopbox():
    # fix round 2: the Article name is the group's context (never "same name"), the product name is the text;
    # every non-exact suggestion is capped at 0.85 (was 0.95)
    found = ItemMatcher(UAT_ITEMS).best(["R-51 HOP BOX", "R-51 HOP BOX"], context=["FA_CE_HOPBOX", "FA_CE_HOPBOX"])
    assert name_of(found) == "HOPBOX" and found.score == 0.85 and found.reason_text == "similar name"


def test_hopbox_written_apart_or_with_a_hyphen_is_the_same_name():
    for text in ("HOP BOX", "Hop-Box", "hopbox", " HOP  BOX. "):
        found = best([text])
        assert name_of(found) == "HOPBOX" and found.score == 1.0 and found.reason_text == "same name", text
    assert compact("Hop-Box") == compact("HOP BOX") == "hopbox"


def test_only_an_exact_name_is_a_hundred_percent():
    assert best(["AI BOX"]).score == 1.0
    assert best(["ai-box"]).score == 1.0
    assert best(["NEW AI BOX UNIT"]).score < 1.0
    assert best(["UPS"]).score == 1.0 and best(["APC UPS 1KVA"]).score == 0.85          # fix 2: cap 0.85


def test_generic_words_alone_suggest_nothing():
    for text in ("BOX", "PVC BOX", "SMALL STAND", "CAT6 WIRE 4X4", "SET OF 2"):
        assert best([text]) is None, text


def test_a_thing_described_by_another_items_name_is_not_that_item():
    # CAMERA PVC BOX is a box for a camera; LAPTOP STAND is a stand -- not the camera, not the laptop
    assert best(["FA_CE_CAMERA PVC BOX"]) is None
    assert best(["LAPTOP STAND"]) is None
    assert best(["LAPTOP SLEEVE 14 INCH BLACK"]) is None                    # sizes / colours after the thing-word skipped
    assert name_of(best(["LAPTOP 14 INCH"])) == "LAPTOP"
    assert name_of(best(["CAMERA 2MP DOME"])) == "CAMERA"


def test_a_half_match_is_no_suggestion():
    found = ItemMatcher(UAT_ITEMS).score(UAT_ITEMS[3], ["48 PORT SWITCH"])     # Network Switch: one word of two
    assert found is not None and found.score < SUGGESTION_THRESHOLD
    assert best(["48 PORT SWITCH"]) is None
    assert name_of(best(["NETWORK SWITCH 24 PORT"])) == "Network Switch"


def test_rare_words_count_more_than_common_ones():
    printers = items("Zebra Printer", "HP Printer", "Canon Printer", "Epson Printer", "Brother Printer", "Ricoh Printer")
    matcher = ItemMatcher(printers)
    # fix round 2: an Item that ADDS a word the text lacks scores lower, so "ZEBRA GK420T" alone (no PRINTER)
    # is no longer enough for a suggestion -- but the rare word still counts far more than the common one
    zebra = matcher.score(printers[0], ["ZEBRA GK420T"])
    assert zebra is not None and zebra.score > 0.5 and matcher.score(printers[1], ["ZEBRA GK420T"]) is None
    assert name_of(best(["ZEBRA GK420T LABEL PRINTER"], printers)) == "Zebra Printer"
    assert best(["THERMAL PRINTER 4 INCH"], printers) is None                    # the common word alone is not


def test_the_more_specific_of_two_full_matches_wins():
    assert name_of(best(["DELL OPTIPLEX DESKTOP"])) == "Dell Desktop"
    assert name_of(best(["LENOVO DESKTOP I3"])) == "Desktop"


def test_an_item_named_only_with_generic_words_is_the_last_resort():
    assert name_of(best(["HDMI CABLE 2M"])) == "Cable" and best(["HDMI CABLE 2M"]).score == SUGGESTION_THRESHOLD
    pool = items("Cable", "HDMI Splitter")
    assert name_of(best(["HDMI SPLITTER"], pool)) == "HDMI Splitter"
    # an HDMI splitter CABLE is a cable: the splitter Item only describes it, so the generic Item is the answer
    assert name_of(best(["HDMI SPLITTER CABLE"], pool)) == "Cable"


def test_nothing_below_the_safe_threshold_and_the_words_used():
    assert SUGGESTION_THRESHOLD == 0.6
    assert all(f.score >= SUGGESTION_THRESHOLD for f in ItemMatcher(UAT_ITEMS).candidates(["GONDOLA RACK 4FT 5 SHELF"]))
    assert is_generic("4x4") and is_generic("box") and is_generic("12mm") and not is_generic("i3") and not is_generic("hopbox")


def test_the_old_entry_point_gives_the_same_answer():
    found, score = suggest_item(UAT_ITEMS, ["R-51 HOP BOX"])
    assert (found.name, score) == ("HOPBOX", 0.85)
    assert suggest_item(UAT_ITEMS, ["GANG BOX PVC 4X4"]) == (None, 0.0)


# ------------------------------------------------------------------ through the screens

async def _box_world(erp) -> dict:
    ids = await build_s3a2_world(erp)
    async with SessionLocal() as s:
        cat = (await s.execute(select(AssetCategory).where(AssetCategory.code == "COMP"))).scalar_one()
        sub = (await s.execute(select(AssetSubcategory).where(AssetSubcategory.code == "CPU"))).scalar_one()
        ai_box = Item(name="AI BOX", category_id=cat.id, subcategory_id=sub.id)
        hopbox = Item(name="HOPBOX", category_id=cat.id, subcategory_id=sub.id)
        s.add_all([ai_box, hopbox])
        await s.commit()
        ids.update({"ai_box": ai_box.id, "hopbox": hopbox.id})
    erp.erp_items.update({
        "CT600001": ErpItem("CT600001", "FA_CE_CAMERA PVC BOX", "FA_CE_CAMERA PVC BOX", "COMPUTER EQUIPMENT",
                            "FA_CE_CAMERA PVC BOX", cats=["GANG BOX PVC 4X4"]),
        "CT600002": ErpItem("CT600002", "FA_CE_HOPBOX", "FA_CE_HOPBOX", "COMPUTER EQUIPMENT", "FA_CE_HOPBOX",
                            cats=["R-51 HOP BOX"]),
        "CT600003": ErpItem("CT600003", "FA_CE_AIBOX", "FA_CE_AIBOX", "COMPUTER EQUIPMENT", "FA_CE_AIBOX", cats=["AI BOX"]),
    })
    erp.pos[5001] = bs_po(lines=[line(1, "CT600001", "GANG BOX PVC 4X4", 2, 100), line(2, "CT600002", "R-51 HOP BOX", 3, 100),
                                 line(3, "CT600003", "AI BOX", 1, 100)])
    return ids


async def test_the_po_review_suggests_hopbox_and_never_ai_box_for_the_gang_box(client, erp):
    ids = await _box_world(erp)
    resp = await client.get("/api/erp/pos/5001/draft", headers=await _headers(client, "OPR"))
    assert resp.status_code == 200, resp.text
    gang, hop, ai = resp.json()["lines"]
    assert (gang["suggested_item_id"], gang["suggestion_score"], gang["suggestion_reason"]) == (None, None, None)
    assert (hop["suggested_item_id"], hop["suggested_item_name"], hop["suggestion_score"]) == (ids["hopbox"], "HOPBOX", 0.85)
    assert (hop["suggestion_reason"], hop["suggestion_reason_code"]) == ("similar name", "SIMILAR_NAME")
    assert (ai["suggested_item_id"], ai["suggestion_score"], ai["suggestion_reason"]) == (ids["ai_box"], 1.0, "same name")


async def test_the_erp_inbox_uses_the_same_scoring(client, erp):
    ids = await _box_world(erp)
    resp = await client.get("/api/erp/inbox", headers=await _headers(client))
    assert resp.status_code == 200, resp.text
    groups = {g["article_key"]: g for g in resp.json()["items"]}
    assert groups["FA_CE_CAMERA PVC BOX"]["suggested_item_id"] is None
    assert (groups["FA_CE_HOPBOX"]["suggested_item_id"], groups["FA_CE_HOPBOX"]["suggestion_reason"]) == (ids["hopbox"], "similar name")
    assert (groups["FA_CE_AIBOX"]["suggested_item_id"], groups["FA_CE_AIBOX"]["suggestion_score"]) == (ids["ai_box"], 1.0)


async def test_a_decided_code_still_resolves_by_its_rule_and_gets_no_suggestion(client, erp):
    """The rule engine's precedence is unchanged: a rule decides, a suggestion is only for undecided codes."""
    ids = await _box_world(erp)
    async with SessionLocal() as s:
        s.add(ItemMap(item_id=ids["ai_box"], match_type="CODE", erp_item_code="CT600002", company_id=ids["spl"]))
        await s.commit()
    _, hop, _ = (await client.get("/api/erp/pos/5001/draft", headers=await _headers(client, "OPR"))).json()["lines"]
    assert hop["resolution"]["state"] == "MATCHED" and hop["item_id"] == ids["ai_box"] and hop["resolution"]["via"] == "CODE"
    assert hop["suggested_item_id"] is None and hop["suggestion_reason"] is None


async def test_the_articles_screen_gives_the_score_and_the_reason(client, erp):
    ids = await _box_world(erp)
    from app.erp.source import ErpArticle
    erp.articles = [ErpArticle("FA_CE_HOPBOX", "FA_CE_HOPBOX", "COMPUTER EQUIPMENT", "FA_CE_HOPBOX", codes=1, units=3, lines=1,
                               samples=["R-51 HOP BOX"]),
                    ErpArticle("FA_CE_CAMERA PVC BOX", "FA_CE_CAMERA PVC BOX", "COMPUTER EQUIPMENT", "FA_CE_CAMERA PVC BOX",
                               codes=1, units=2, lines=1, samples=["GANG BOX PVC 4X4"])]
    rows = {r["article_key"]: r for r in (await client.get("/api/items/articles", headers=await _headers(client))).json()}
    assert (rows["FA_CE_HOPBOX"]["suggested_item_id"], rows["FA_CE_HOPBOX"]["suggestion_score"],
            rows["FA_CE_HOPBOX"]["suggestion_reason"]) == (ids["hopbox"], 0.85, "similar name")
    assert rows["FA_CE_CAMERA PVC BOX"]["suggested_item_id"] is None
