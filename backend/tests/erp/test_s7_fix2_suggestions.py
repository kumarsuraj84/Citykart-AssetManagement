"""S7 fix round 2 (N1 / N2): the wrong "Similar name (95%)" suggestions the re-test found on the UAT copy.

The UAT copy's 64 active Items are the fixture (UAT_ITEMS); each case is an ERP group / product the re-test
reported: an indoor camera got CAMERA BOX PVC although INDOOR CAMERA exists, a queue manager got CABLE
MANAGER, a barcode printer got BARCODE_PRINTER_STAND, the group TABLE_OFFICE (a table and an office chair) was
"Office Chair - Same name", and the PO review said "Same name" where the inbox said "Similar name (95%)" for
the same code."""
from types import SimpleNamespace

from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.source import ErpArticle, ErpItem
from app.items.models import Item
from app.items.suggest import (
    SAME_NAME, SCORE_CAP, SIMILAR_NAME, SUGGESTION_THRESHOLD, ItemMatcher, clean_erp_text, word_kind,
)
from app.masters.models import AssetCategory, AssetSubcategory
from tests.erp.s3a2_world import bs_po, build_s3a2_world
from tests.erp.test_erp_api import _headers, erp, line  # noqa: F401  (erp is a fixture)

UAT_NAMES = [
    "AI BOX", "AMPLIFIER BIG", "AMPLIFIER SMALL", "AUX_CABLE", "BARCODE PRINTER", "BARCODE SCANNER",
    "BARCODE_PRINTER_STAND", "CABLE MANAGER", "CAMERA BOX PVC", "CAT6_WIRE BUNDLE", "CPU", "CPU-ASSEMBLE", "CPU-REFURB",
    "DESKTOP", "DOCUMENT PRINTER", "DOCUMENT SCANNER", "DP_CONNECTOR", "FOOTFALL SENSOR DEVICE", "GANGBOX",
    "Gondola Rack", "HARDDISK_EXTERNAL", "HARDDISK_INTERNAL", "HARDWARE PACKET", "HDMI_CABLE", "HDMI_CONNECTOR",
    "HHT SCANNER", "HHT SCANNER GUN", "HOPBOX", "HOPBOX ADAPTOR", "INDOOR CAMERA", "IT RACK", "KEYBOARD_WIRED",
    "LANDLINE PHONE", "LAPTOP", "LAPTOP-REFURB", "LAPTOP_BAG", "MOUSE_WIRED", "MOUSE_WIRELESS", "MS WINDOWS OS",
    "MS WINDOWS SERVER OS", "NAS", "NETWORK SWITCH", "NVR DEVICE", "OUTDOOR CAMERA", "Office Chair", "PDU SOCKET",
    "POS PRINTER", "PROJECTOR", "PROJECTOR_STAND", "RAM", "RJ45 CONNECTOR", "SERVER", "SPEAKER BIG", "SPEAKER SMALL",
    "SPEAKER STAND", "SSD_EXTERNAL", "SSD_INTERNAL", "Split AC 1.5 Ton", "TFT", "UAT Desktop Set", "UPS BIG",
    "UPS SMALL", "WIFI ROUTER", "mic",
]


def items(names):
    return [SimpleNamespace(id=n, name=name) for n, name in enumerate(names, start=1)]


UAT_ITEMS = items(UAT_NAMES)
M = ItemMatcher(UAT_ITEMS)


def item(name):
    return next(i for i in UAT_ITEMS if i.name == name)


def name_of(found):
    return found.item.name if found is not None else None


def without(*names):
    return ItemMatcher(items([n for n in UAT_NAMES if n not in names]))


# ------------------------------------------------------------------ the re-test's cases (N1)

def test_an_indoor_camera_is_the_indoor_camera_never_the_camera_box():
    ctx = ["FA_OE_CCTV_INDOOR", "FA_CE_CCTV"]
    found = M.best(["INDOOR CAMERA @POE"], context=ctx)
    assert (name_of(found), found.score, found.reason) == ("INDOOR CAMERA", SCORE_CAP, SIMILAR_NAME)
    box = M.score(item("CAMERA BOX PVC"), ["INDOOR CAMERA @POE"], ctx)
    assert box is None or box.score < SUGGESTION_THRESHOLD           # adds BOX + PVC, misses INDOOR
    # even without the INDOOR CAMERA Item the camera box is never offered for a camera
    assert without("INDOOR CAMERA").best(["INDOOR CAMERA @POE"], context=ctx) is None
    # a dome camera (indoor or outdoor? the name does not say) gets no suggestion at all
    assert M.best(["HIKVISION DOME CAMERA 2.4 GHZ"], context=["FIXED ASSETS-IT EQUIPMENST-NEW DEPARTMENT", "FA_CE_CCTV"]) is None


def test_a_queue_manager_is_not_a_cable_manager():
    ctx = ["FA_FF_Q MANAGER", "FA_FF_Q MANAGER"]
    for names in (["2 LAYER (3/1)"], ["GURU NANAK STEEL INDUSTRIES"], ["QUEUE MANAGER"]):
        assert M.best(names, context=ctx) is None, names
    cable = M.score(item("CABLE MANAGER"), ["QUEUE MANAGER"], ctx)
    assert cable is None or cable.score < SUGGESTION_THRESHOLD
    assert name_of(M.best(["CABLE MANAGER"])) == "CABLE MANAGER" and M.best(["CABLE MANAGER"]).reason == SAME_NAME


def test_a_barcode_printer_is_the_printer_not_its_stand():
    ctx = ["FA_CE_PRINTER_BARCODE", "FA_CE_PRINTER"]
    found = M.best(["PRINTER BARCODE|GODEX|G-500"], context=ctx)
    assert name_of(found) == "BARCODE PRINTER" and found.score <= SCORE_CAP
    stand = M.score(item("BARCODE_PRINTER_STAND"), ["PRINTER BARCODE|GODEX|G-500"], ctx)
    assert stand is None or stand.score < SUGGESTION_THRESHOLD
    assert without("BARCODE PRINTER").best(["PRINTER BARCODE|GODEX|G-500"], context=ctx) is None
    # ... and the stand is still found for a stand
    assert name_of(M.best(["FA_CE_BARCODE_PRINTER _GODEX STAND"])) == "BARCODE_PRINTER_STAND"


def test_the_table_office_group_gets_no_confident_suggestion():
    names, ctx = ["TABLE 4*2", "OFFICE CHAIR"], ["FA_FF_TABLE_OFFICE", "FA_FF_TABLE"]
    assert M.best_for_group(names, ctx) is None
    assert M.for_erp(names, [], ctx, "ARTICLE") == (None, None)                 # the inbox group
    # in the PO review the chair line is the Office Chair -- for its own product name, not the whole group
    found, reach = M.for_erp(["OFFICE CHAIR"], ["office chair", "table 4 2"], ctx, "ARTICLE")
    assert (name_of(found), found.reason, reach) == ("Office Chair", SAME_NAME, "NAME")
    assert M.for_erp(["TABLE 4*2"], ["office chair", "table 4 2"], ctx, "ARTICLE") == (None, None)


def test_gang_box_is_never_ai_box_and_never_a_coin_flip():
    ctx = ["FA_CE_CAMERA PVC BOX", "FA_CE_CAMERA PVC BOX"]
    assert name_of(M.best(["GANG BOX PVC 4 X 4"], context=ctx)) != "AI BOX"
    ai = M.score(item("AI BOX"), ["GANG BOX PVC 4 X 4"], ctx)
    assert ai is None                                                         # only BOX in common
    # the product name says GANGBOX, the ERP group says camera PVC box: too close to call -> none
    assert M.best(["GANG BOX PVC 4 X 4"], context=ctx) is None
    # with no camera-box Item the gang box is plainly the GANGBOX
    assert name_of(without("CAMERA BOX PVC").best(["GANG BOX PVC 4 X 4"], context=ctx)) == "GANGBOX"


def test_r51_hop_box_is_still_hopbox():
    found = M.best(["R-51 HOP BOX"], context=["FA_CE_HOPBOX", "FA_CE_HOPBOX"])
    assert (name_of(found), found.score, found.reason) == ("HOPBOX", SCORE_CAP, SIMILAR_NAME)
    assert name_of(M.best(["HOPBOX ADAPTOR 12V"])) == "HOPBOX ADAPTOR"


def test_exact_names_are_still_a_hundred_percent():
    for text, expected in (("HOPBOX", "HOPBOX"), ("Hop-Box", "HOPBOX"), ("INDOOR CAMERA", "INDOOR CAMERA"),
                           ("office chair", "Office Chair"), ("BARCODE_PRINTER_STAND", "BARCODE_PRINTER_STAND"),
                           ("split ac 1.5 ton", "Split AC 1.5 Ton")):
        found = M.best([text])
        assert (name_of(found), found.score, found.reason) == (expected, 1.0, SAME_NAME), text


def test_no_non_exact_suggestion_above_the_cap():
    for text in ("INDOOR CAMERA @POE", "R-51 HOP BOX", "HP LAPTOP", "5 PORT POE SWITCH", "NETWORK SWITCH 24 PORT",
                 "HHT SCANNER(RS36 Wi-Fi )"):
        found = M.best([text], context=["FA_CE_" + text.split()[0]])
        assert found is None or (found.score <= SCORE_CAP and found.reason == SIMILAR_NAME), text


def test_two_items_within_a_tenth_give_no_suggestion():
    assert M.best(["UPS(1000 APC VA)"], context=["FIXED ASSETS-COMPUTER EQUIPMENT-FA_CE_UPS", "FA_CE_UPS"]) is None
    assert name_of(M.best(["UPS SMALL 600VA"])) == "UPS SMALL"
    # the hardware packet of an IT rack: HARDWARE PACKET and IT RACK both fit the group's name about equally
    assert M.best(["HARDWEAR PKT"], context=["FA_CE_IT RACK_HARDWARE PACKET", "FA_IT_OTHERS"]) is None


def test_a_group_of_several_product_names_is_judged_jointly_and_never_same_name():
    found = M.best_for_group(["RAM", "RAM 16GB", "RAM THINKSRVR 8GB"], ["FIXED ASSETS-IT EQUIPMENTS-FA_IT_RAM", "FA_IT_RAM"])
    assert name_of(found) == "RAM" and found.reason == SIMILAR_NAME and found.score < SCORE_CAP
    # wired and wireless mice in one group: neither mouse Item fits the whole group
    assert M.best_for_group(["MOUSE DELL USB", "MOUSE LOGITECH", "WIRELESS MOUSE"], ["01-MOUSE[IT-01]", "FA_CE_MOUSE"]) is None
    # a catch-all group never borrows one member's exact name
    assert M.best_for_group(["CABLE MANAGER", "INSTALLATION CHARGES", "CONTROLLER"],
                            ["FIXED ASSETS-IT EQUIPMENST-FA_IT_OTHERS", "FA_CE_OTHERS"]) is None
    # one distinct product name (written two ways) is still that product
    assert M.best_for_group(["HOP BOX", "hopbox"], []).reason == SAME_NAME


def test_racks_and_pallets_are_not_the_it_rack():
    assert M.best(["PALLETS"], context=["FA_FF_DC RACK", "FA_FF_RACKS"]) is None
    assert M.best(["SEMI-HEAVY DUTY RACK"], context=["FURNITURE & FIXTURE-FA_FF_RACKS", "FA_FF_RACKS"]) is None


def test_the_right_suggestions_of_the_uat_copy_are_kept():
    cases = [
        (["HP LAPTOP"], ["01-IDEAPAD 330[IT-01]", "FA_CE_LAPTOP"], "LAPTOP"),
        (["HHT SCANNER(RS36 Wi-Fi )"], ["FA_CE_SCANNER", "FA_CE_SCANNER"], "HHT SCANNER"),
        (["5 PORT POE SWITCH"], ["FA_CE_NETWORK SWITCH", "FA_CE_NETWORK SWITCH"], "NETWORK SWITCH"),
        (["ST50 v3 7DF3A02NSG"], ["FA_CE_SERVER", "FA_CE_SERVER"], "SERVER"),
        (["HP LAZERJET M136 NW"], ["FA_CE_PRINTER_DOCUMENT", "FA_CE_PRINTER"], "DOCUMENT PRINTER"),
        (["OUTDOOR CAMERA @POE"], ["FA_OE_CCTV_OUTDOOR", "FA_CE_CCTV"], "OUTDOOR CAMERA"),
    ]
    for names, ctx, expected in cases:
        assert name_of(M.best(names, context=ctx)) == expected, names


def test_erp_prefixes_and_word_kinds():
    assert clean_erp_text("FA_CE_HOPBOX") == "HOPBOX"
    assert clean_erp_text("FIXED ASSETS-IT EQUIPMENST-FA_IT_LAPTOP") == "LAPTOP"
    assert clean_erp_text("FA_CE_IT RACK_HARDWARE PACKET") == "IT RACK_HARDWARE PACKET"
    assert clean_erp_text("01-MOUSE[IT-01]").strip() == "01-MOUSE"
    assert clean_erp_text("GANG BOX PVC 4 X 4") == "GANG BOX PVC 4 X 4"
    assert (word_kind("box"), word_kind("ups"), word_kind("4x4"), word_kind("kva"), word_kind("it")) == (
        "weak", "strong", "filler", "filler", "strong")


def test_an_erp_group_name_alone_is_never_same_name():
    found = M.best([], context=["FA_CE_HOPBOX"])
    assert name_of(found) == "HOPBOX" and found.reason == SIMILAR_NAME and found.score < SCORE_CAP


# ------------------------------------------------------------------ the PO review and the ERP inbox agree (N2)

async def _world(erp) -> dict:
    ids = await build_s3a2_world(erp)
    async with SessionLocal() as s:
        cat = (await s.execute(select(AssetCategory).where(AssetCategory.code == "COMP"))).scalar_one()
        sub = (await s.execute(select(AssetSubcategory).where(AssetSubcategory.code == "CPU"))).scalar_one()
        made = {n: Item(name=n, category_id=cat.id, subcategory_id=sub.id) for n in ("AI BOX", "HOPBOX", "CAMERA BOX PVC", "INDOOR CAMERA")}
        s.add_all(made.values())
        await s.commit()
        ids.update({n: i.id for n, i in made.items()})
    erp.erp_items.update({
        # the ERP item master calls it R-51 HOP BOX, the PO line says HOPBOX
        "CT600002": ErpItem("CT600002", "FA_CE_HOPBOX", "FA_CE_HOPBOX", "COMPUTER EQUIPMENT", "FA_CE_HOPBOX", cats=["R-51 HOP BOX"]),
        "CT600010": ErpItem("CT600010", "FA_OE_CCTV_INDOOR", "FA_OE_CCTV_INDOOR", "FA_CE_CCTV", "FA_CE_CCTV",
                            cats=["INDOOR CAMERA @POE"]),
        "CT700001": ErpItem("CT700001", "FA_FF_TABLE_OFFICE", "FA_FF_TABLE_OFFICE", "FA_FF_TABLE", "FA_FF_TABLE", cats=["TABLE 4*2"]),
        "CT700002": ErpItem("CT700002", "FA_FF_TABLE_OFFICE", "FA_FF_TABLE_OFFICE", "FA_FF_TABLE", "FA_FF_TABLE", cats=["OFFICE CHAIR"]),
    })
    erp.articles = [*erp.articles, ErpArticle("FA_FF_TABLE_OFFICE", "FA_FF_TABLE_OFFICE", "FA_FF_TABLE", "FA_FF_TABLE", codes=2,
                                              units=3, lines=2, samples=["TABLE 4*2", "OFFICE CHAIR"], names=["TABLE 4*2", "OFFICE CHAIR"])]
    erp.pos[5001] = bs_po(lines=[line(1, "CT600002", "HOPBOX", 3, 100), line(2, "CT600010", "INDOOR CAMERA @POE PHILIP PLUS 3 Mp", 2, 100),
                                 line(3, "CT700001", "TABLE 4*2", 1, 100), line(4, "CT700002", "OFFICE CHAIR", 2, 100)])
    return ids


FIELDS = ("suggested_item_id", "suggested_item_name", "suggestion_score", "suggestion_reason", "suggestion_reason_code",
          "suggestion_scope")


async def test_the_po_review_and_the_inbox_give_one_answer_for_one_code(client, erp):
    ids = await _world(erp)
    draft = await client.get("/api/erp/pos/5001/draft", headers=await _headers(client, "OPR"))
    assert draft.status_code == 200, draft.text
    lines = {ln["item_code"]: ln for ln in draft.json()["lines"]}
    inbox = await client.get("/api/erp/inbox", headers=await _headers(client))
    assert inbox.status_code == 200, inbox.text
    groups = {g["article_key"]: g for g in inbox.json()["items"]}
    hop_line, hop_group = lines["CT600002"], groups["FA_CE_HOPBOX"]
    # before: the review said "Same name" (it compared the PO line's own text HOPBOX), the inbox "Similar name (95%)"
    assert tuple(hop_line[f] for f in FIELDS) == tuple(hop_group[f] for f in FIELDS) == (
        ids["HOPBOX"], "HOPBOX", 0.85, "similar name", "SIMILAR_NAME", "ARTICLE")
    cam_line, cam_group = lines["CT600010"], groups["FA_OE_CCTV_INDOOR"]
    assert tuple(cam_line[f] for f in FIELDS) == tuple(cam_group[f] for f in FIELDS)
    assert cam_line["suggested_item_id"] == ids["INDOOR CAMERA"] and cam_line["suggestion_score"] <= 0.85


async def test_a_mixed_erp_group_is_never_one_click_away_from_a_wrong_item(client, erp):
    ids = await _world(erp)
    lines = {ln["item_code"]: ln for ln in (await client.get("/api/erp/pos/5001/draft", headers=await _headers(client, "OPR"))).json()["lines"]}
    # the chair line: the Office Chair, but for this product name only (the group also holds a table)
    chair = lines["CT700002"]
    assert (chair["suggested_item_id"], chair["suggestion_reason"], chair["suggestion_scope"], chair["suggested_scope"]) == (
        ids["item_chair"], "same name", "NAME", "ARTICLE")
    assert lines["CT700001"]["suggested_item_id"] is None                  # the table: nothing
    group = next(g for g in (await client.get("/api/erp/inbox", headers=await _headers(client))).json()["items"]
                 if g["article_key"] == "FA_FF_TABLE_OFFICE")
    assert [c["icode"] for c in group["codes"]] == ["CT700001", "CT700002"]
    assert all(group[f] is None for f in FIELDS)                             # was "Office Chair - Same name"


async def test_the_articles_screen_judges_an_article_as_a_group(client, erp):
    ids = await _world(erp)
    rows = {r["article_key"]: r for r in (await client.get("/api/items/articles", headers=await _headers(client))).json()}
    assert rows["FA_FF_TABLE_OFFICE"]["suggested_item_id"] is None
    assert rows["FA_FF_TABLE_OFFICE"]["suggestion_reason_code"] is None
    assert ids["item_chair"]                                                # the Office Chair Item exists
