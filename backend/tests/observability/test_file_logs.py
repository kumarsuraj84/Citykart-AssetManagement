"""S8: JSON-lines log files -- the access line, error.jsonl, audit.jsonl, rotation, the fallback when LOG_DIR
cannot be written, and redaction of every line."""
import logging
import logging.handlers
import os

from app.core.config import settings
from app.observability import filelog
from tests.core.s0_world import PASSWORD, build_world, login
from tests.observability.helpers import flush_logs, log_lines

ACCESS_KEYS = {"ts", "level", "request_id", "actor_id", "role", "ip", "method", "route", "path", "status",
               "duration_ms", "bytes"}


async def test_one_access_line_per_request_with_the_required_keys(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.get(f"/api/assets/{999999}", headers=h)
    assert resp.status_code == 404
    flush_logs()
    lines = [x for x in log_lines("app.jsonl") if x.get("request_id") == resp.headers["x-request-id"]
             and x.get("kind") == "access"]
    assert len(lines) == 1
    line = lines[0]
    assert ACCESS_KEYS <= set(line)
    assert (line["method"], line["route"], line["path"], line["status"]) == ("GET", "/api/assets/{asset_id}",
                                                                            "/api/assets/999999", 404)
    assert line["actor_id"] == w["admin"] and line["role"] == "ADMIN" and line["level"] == "INFO"
    assert line["duration_ms"] >= 0 and line["bytes"] > 0 and "sql_count" in line


async def test_a_route_of_a_nested_router_is_logged_with_its_full_template(client):
    w = await build_world()
    resp = await client.put(f"/api/masters/vendors/{w['vendor']}", headers=await login(client, w, "owner"),
                            json={"name": "Template Vendor"})
    assert resp.status_code == 200
    [line] = [x for x in log_lines("app.jsonl") if x.get("request_id") == resp.headers["x-request-id"]
              and x.get("kind") == "access"]
    assert line["route"] == "/api/masters/vendors/{item_id}"


async def test_errors_go_to_error_jsonl_with_their_stack(client, monkeypatch):
    import app.assets.tools_router as tools
    import pytest

    w = await build_world()

    async def broken(*args, **kwargs):
        raise RuntimeError("file log boom")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    with pytest.raises(RuntimeError):
        await client.post("/api/assets/batch", headers=await login(client, w, "owner"), json={
            "item_id": 1, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    flush_logs()
    [line] = [x for x in log_lines("error.jsonl") if x.get("exception_type") == "RuntimeError"
              and "file log boom" in x.get("msg", "")]
    assert line["level"] == "ERROR" and "file log boom" in line["msg"] and "Traceback" in line["stack"]
    assert line["route"] == "/api/assets/batch" and line["request_id"]


async def test_nothing_secret_reaches_the_files(client):
    await build_world()
    await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": PASSWORD})
    await client.get("/api/assets", headers={"Authorization": "Bearer eyJabc.eyJdef.signaturepart"})
    logging.getLogger("ckam.test").warning("connecting with password=Hunter2 and Bearer abc.def.ghi")
    flush_logs()
    text = ""
    for name in filelog.FILES:
        path = os.path.join(filelog.directory(), name)
        if os.path.exists(path):
            text += open(path, encoding="utf-8").read()
    for secret in (PASSWORD, "Hunter2", "abc.def.ghi", "signaturepart", settings.jwt_secret):
        assert secret not in text, secret


def test_each_file_rotates_at_20_mb_keeping_10():
    handlers = [h for name in ("ckam", "ckam.audit") for h in logging.getLogger(name).handlers
                if isinstance(h, logging.handlers.RotatingFileHandler)]
    names = sorted(os.path.basename(h.baseFilename) for h in handlers)
    assert names == ["app.jsonl", "audit.jsonl", "error.jsonl"]
    assert all(h.maxBytes == 20 * 1024 * 1024 and h.backupCount == 10 for h in handlers)


def test_uvicorn_access_log_is_switched_off():
    assert logging.getLogger("uvicorn.access").disabled is True


def test_an_unwritable_log_dir_falls_back_to_stderr_and_says_why(tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("a file where the directory should be")
    original = filelog.directory()
    try:
        filelog.setup(str(blocker / "logs"), "INFO")
        assert filelog.problem() is not None
        assert not filelog.writable_now()
        root = logging.getLogger("ckam")
        assert not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers)
        assert any(isinstance(h, logging.StreamHandler) and getattr(h, "_ckam", False) for h in root.handlers)
    finally:
        filelog.setup(original, settings.log_level)
    assert filelog.problem() is None and filelog.writable_now()


async def test_the_startup_event_reports_an_unwritable_log_dir(tmp_path):
    from app.observability import system
    from app.observability.models import SystemEvent
    from tests.observability.helpers import system_events

    blocker = tmp_path / "file"
    blocker.write_text("x")
    original = filelog.directory()
    try:
        filelog.setup(str(blocker / "logs"), "INFO")
        await system.on_startup()
    finally:
        filelog.setup(original, settings.log_level)
    events = [e.event for e in await system_events(SystemEvent.component == "config")]
    assert events == ["log_dir_unwritable"]


def test_a_directory_that_does_not_exist_yet_is_made(tmp_path):
    original = filelog.directory()
    target = tmp_path / "deep" / "logs"
    try:
        filelog.setup(str(target), "INFO")
        assert target.is_dir() and filelog.problem() is None
    finally:
        filelog.setup(original, settings.log_level)
