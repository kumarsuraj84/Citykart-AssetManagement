"""S8: POST /api/client-reports -- any signed-in person; redacted, cut to 64 KB, the same report counted once a
minute, at most 30 a minute."""
import json

from app.observability.models import ClientReport
from tests.core.s0_world import build_world, login
from tests.observability.helpers import client_reports, everything_logged


def report(**over) -> dict:
    body = {"kind": "JS_ERROR", "message": "TypeError: x is undefined", "stack": "at AssetPage (assets.tsx:10)",
            "route": "/assets/12", "app_version": "8231308", "breadcrumbs": [{"t": "click", "target": "Save"}],
            "recent_requests": [{"method": "GET", "url": "/api/assets/12", "status": 200, "request_id": "abc"}],
            "note": None}
    body.update(over)
    return body


async def test_a_signed_in_person_can_report_and_gets_a_reference(client):
    w = await build_world()
    h = await login(client, w, "viewer_it")
    resp = await client.post("/api/client-reports", headers=h, json=report(note="It broke when I saved"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["reference"] == resp.headers["x-request-id"] and body["duplicate"] is False
    [row] = await client_reports()
    assert (row.id, row.kind, row.status, row.actor_id, row.actor_code) == (body["id"], "JS_ERROR", "NEW",
                                                                           w["viewer_it"], "S0VWIT")
    assert row.reference == body["reference"] and row.request_id == body["reference"]
    assert row.app_version == "8231308" and row.note == "It broke when I saved" and len(row.fingerprint) == 40
    assert row.breadcrumbs == [{"t": "click", "target": "Save"}]


async def test_the_failed_requests_id_is_kept(client):
    w = await build_world()
    resp = await client.post("/api/client-reports", headers=await login(client, w, "op_it"),
                             json=report(kind="API_ERROR", request_id="0123456789abcdef0123456789abcdef"))
    [row] = await client_reports(ClientReport.id == resp.json()["id"])
    assert row.request_id == "0123456789abcdef0123456789abcdef" and row.reference == resp.json()["reference"]


async def test_reports_need_a_session_and_a_known_kind(client):
    w = await build_world()
    assert (await client.post("/api/client-reports", json=report())).status_code == 401
    bad = await client.post("/api/client-reports", headers=await login(client, w, "op_it"), json=report(kind="CRASH"))
    assert bad.status_code == 422 and bad.json()["request_id"]


async def test_secrets_in_a_report_are_masked(client):
    w = await build_world()
    secret_token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2VjcmV0LXNpZ25hdHVyZQ"
    resp = await client.post("/api/client-reports", headers=await login(client, w, "op_it"), json=report(
        message=f"failed with Authorization: Bearer {secret_token}",
        breadcrumbs=[{"form": {"login_id": "S0OPIT", "password": "Hunter2!"}}],
        recent_requests=[{"url": "/api/auth/login", "headers": {"Authorization": f"Bearer {secret_token}"}}],
        note="my password: Hunter2!"))
    assert resp.status_code == 201
    text = await everything_logged()
    assert secret_token not in text and "Hunter2!" not in text and "c2VjcmV0LXNpZ25hdHVyZQ" not in text
    [row] = await client_reports()
    assert row.breadcrumbs[0]["form"]["password"] == "***" and row.breadcrumbs[0]["form"]["login_id"] == "S0OPIT"


async def test_a_huge_report_is_cut_to_64_kb(client):
    w = await build_world()
    resp = await client.post("/api/client-reports", headers=await login(client, w, "op_it"), json=report(
        stack="frame\n" * 30000, breadcrumbs=[{"i": i, "pad": "p" * 200} for i in range(400)],
        recent_requests=[{"i": i, "url": "/api/x" * 20} for i in range(150)], note="n" * 15000))
    assert resp.status_code == 201, resp.text
    [row] = await client_reports()
    size = len(json.dumps({c.key: getattr(row, c.key) for c in row.__table__.columns}, default=str).encode())
    assert size <= 70 * 1024
    assert row.breadcrumbs and row.breadcrumbs[-1]["i"] == 399          # the newest breadcrumbs are kept


async def test_the_same_report_within_a_minute_is_stored_once(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    first = await client.post("/api/client-reports", headers=h, json=report())
    again = await client.post("/api/client-reports", headers=h, json=report())
    other = await client.post("/api/client-reports", headers=h, json=report(message="Another problem"))
    assert first.status_code == 201 and again.status_code == 200 and other.status_code == 201
    assert again.json() == {"id": first.json()["id"], "reference": first.json()["reference"], "duplicate": True}
    assert len(await client_reports()) == 2


async def test_more_than_30_reports_a_minute_are_refused(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    for n in range(30):
        resp = await client.post("/api/client-reports", headers=h, json=report(message=f"problem {n}"))
        assert resp.status_code == 201
    refused = await client.post("/api/client-reports", headers=h, json=report(message="one too many"))
    assert refused.status_code == 429
    assert refused.json()["detail"] == "You have sent many problem reports in the last minute. Wait a minute and try again."
    other_person = await client.post("/api/client-reports", headers=await login(client, w, "op_nonit"), json=report())
    assert other_person.status_code == 201


async def test_a_user_report_without_a_stack(client):
    w = await build_world()
    resp = await client.post("/api/client-reports", headers=await login(client, w, "op_it"), json={
        "kind": "USER_REPORT", "message": "Labels print blank", "route": "/labels", "note": "since this morning"})
    assert resp.status_code == 201
    [row] = await client_reports()
    assert row.stack is None and row.breadcrumbs == [] and row.recent_requests == []
