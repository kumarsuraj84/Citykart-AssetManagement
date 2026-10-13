"""S6: every ERP draft line says how many units the ERP still has open for its item code (`open_units`, the
S0.8 cap the create checks) and how many this line may ask for (`max_units`)."""
from app.erp.service import _add_open_units, erp_open_units
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)


def test_open_units_add_up_every_line_of_a_code_after_cancellations():
    po = desktop_po(lines=[line(1, "ct1", "A", 5, 100), line(2, "CT1", "A again", 3, 100, cancelled=1),
                           line(3, "CT2", "B", 2.5, 10), line(4, "CT3", "Gone", 4, 10, cancelled=4)])
    assert erp_open_units(po) == {"CT1": 7, "CT2": 2}                # whole units; a fully cancelled code is not open


def test_max_units_leaves_room_for_the_other_lines_of_the_same_code_and_the_1000_limit():
    po = desktop_po(lines=[line(1, "CT1", "A", 2.5, 100), line(2, "CT1", "A", 2.5, 100), line(3, "CT9", "Big", 1500, 1)])
    lines = [{"item_code": "CT1", "quantity": 2}, {"item_code": "CT1", "quantity": 2}, {"item_code": "CT9", "quantity": 1500}]
    _add_open_units(po, lines)
    assert [(ln["open_units"], ln["max_units"]) for ln in lines] == [(5, 3), (5, 3), (1500, 1000)]


async def test_the_draft_lines_carry_open_and_max_units(client, erp):
    await _setup()
    erp.pos[1133610106] = desktop_po(lines=[line(1, "CT324973", "Desktop", 7, 20000), line(2, "CT324973", "Desktop more", 3, 20000, cancelled=1)])
    d = (await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))).json()
    assert [(ln["quantity"], ln["open_units"], ln["max_units"]) for ln in d["lines"]] == [(7, 9, 7), (2, 9, 2)]


async def test_asking_one_more_than_open_units_is_refused_with_the_same_number(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    erp.pos[1133610106] = desktop_po(lines=[line(1, "CT1", "Good", 2, 100)])
    d = (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()
    [ln] = d["lines"]
    assert (ln["open_units"], ln["max_units"]) == (2, 2)
    body = {"erp_po_code": 1133610106, "company_id": ids["spl"], "po_number": "x", "po_date": "2026-09-18",
            "vendor_id": ids["vansh"], "cost_center_id": ids["cost_spl"],
            "lines": [{"item_code": "CT1", "description": "Good", "barcode": "CT1", "quantity": ln["open_units"] + 1,
                       "rate": 100, "tax_percent": 18, "item_id": ids["item_cable"]}]}
    refused = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert refused.status_code == 422
    assert refused.json()["detail"] == "CT1: 3 units asked, but the ERP purchase order has only 2 open."
    body["lines"][0]["quantity"] = ln["max_units"]
    assert (await client.post("/api/erp/pos/create", headers=h, json=body)).status_code == 201
