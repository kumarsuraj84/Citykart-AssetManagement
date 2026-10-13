"""S0.9 (audit B-10): only the head-office admin saves the asset code rule, and
a rule is checked when it is saved -- not at the first asset that uses it.
Every save answers with a live example; /preview shows one without saving."""
from tests.core.s0_world import build_world, login


def _rule(**over):
    body = {"company_id": None, "prefix_template": "FA/{company.code}/{category.code}/", "suffix_template": "",
            "start_number": 1, "pad_width": 4}
    body.update(over)
    return body


async def test_an_ordinary_admin_cannot_change_the_code_rule(client):
    w = await build_world()
    h = await login(client, w, "admin")
    create = await client.post("/api/code-rules", headers=h, json=_rule())
    assert create.status_code == 403 and create.json()["detail"] == "Only the head-office admin can do this."
    update = await client.put(f"/api/code-rules/{w['rule']}", headers=h, json=_rule())
    assert update.status_code == 403
    listed = await client.get("/api/code-rules", headers=h)
    assert listed.status_code == 200 and listed.json()[0]["prefix_template"] == "S0/{category.code}/"


async def test_invalid_rules_are_refused_when_saved(client):
    w = await build_world()
    h = await login(client, w, "owner")
    cases = [
        (_rule(prefix_template="X-{nonexistent.token}"), "which CKAM does not know"),
        (_rule(prefix_template="X-{company.code"), "a { or } that is not part of a known value"),
        (_rule(prefix_template="   "), "needs a beginning"),
        (_rule(start_number=-5), "The starting number must be between 0"),
        (_rule(pad_width=-1), "The number of digits must be between 0 and 20."),
        (_rule(pad_width=50), "The number of digits must be between 0 and 20."),
        (_rule(suffix_template="-{yyyy}"), "The code ending cannot contain values"),
        (_rule(prefix_template="P" * 301), "too long"),
        (_rule(company_id=999999), "does not exist"),
    ]
    for body, message in cases:
        resp = await client.post("/api/code-rules", headers=h, json=body)
        assert resp.status_code == 422, (body, resp.text)
        assert message in resp.json()["detail"], (body, resp.json())
        preview = await client.post("/api/code-rules/preview", headers=h, json=body)
        assert preview.status_code == 422
    # the old rule is still the active one
    listed = (await client.get("/api/code-rules", headers=h)).json()
    assert [r["id"] for r in listed] == [w["rule"]]


async def test_a_saved_rule_and_a_preview_show_a_live_example(client):
    w = await build_world()
    h = await login(client, w, "owner")
    preview = await client.post("/api/code-rules/preview", headers=h, json=_rule(company_id=w["co"]))
    assert preview.status_code == 200 and preview.json() == {"example": "FA/S0A/IT/0001"}
    viewer = await login(client, w, "viewer_it")
    assert (await client.post("/api/code-rules/preview", headers=viewer, json=_rule())).json()["example"] == "FA/CKSPL/IT/0001"
    saved = await client.post("/api/code-rules", headers=h, json=_rule(start_number=7, pad_width=0, suffix_template="-X"))
    assert saved.status_code == 201 and saved.json()["example"] == "FA/CKSPL/IT/7-X"
    listed = (await client.get("/api/code-rules", headers=h)).json()
    assert listed[0]["example"] == "FA/CKSPL/IT/7-X"
