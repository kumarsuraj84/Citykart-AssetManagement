"""CL2-IF-01 (second half) / CL2-IF-OBS-03 (closure WP-F): a failing audit write is never silent.

Before: the writer printed ONE stderr line per process for a failing audit_log insert and hid every later one, so an
exhausted audit_log id sequence (setval by whoever held the runtime credentials) silently stopped the database audit
trail. Now: the first failure and then at most one report per minute while it repeats, with a running count, on
stderr AND in the error log, plus a system_event row when the database still accepts one; a flood never spams and
nothing ever raises into the request.

The failure is produced the real way: the test database's audit_log id sequence is pushed to its maximum (the
dev/test role is a superuser; the conftest's TRUNCATE ... RESTART IDENTITY resets it for the next test)."""
import logging
from types import SimpleNamespace

from sqlalchemy import text

from app.core.db import SessionLocal
from app.observability import writer
from app.observability.models import AuditLog, SystemEvent
from tests.core.s0_world import build_world
from tests.observability.helpers import rows

PREFIX = "CKAM logging: could not write audit_log"


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


async def _exhaust_audit_log_sequence():
    async with SessionLocal() as s:
        await s.execute(text("SELECT setval('audit_log_id_seq', 9223372036854775807)"))
        await s.commit()


def _error_records(caplog):
    return [r for r in caplog.records if r.name == "ckam.errors" and r.getMessage().startswith(PREFIX)]


async def test_a_repeating_audit_write_failure_is_reported_first_then_once_a_minute_with_a_count(
        monkeypatch, capsys, caplog):
    clock = FakeClock()
    monkeypatch.setattr(writer, "_clock", clock)
    writer.reset_failure_reports()
    caplog.set_level(logging.ERROR, logger="ckam.errors")
    await _exhaust_audit_log_sequence()

    await writer.security("TEST_EVENT", "first")                       # 1st failure: reported at once
    err = capsys.readouterr().err
    assert err.count(PREFIX) == 1 and "Failure 1" in err and "reached maximum value" in err
    assert len(_error_records(caplog)) == 1

    for i in range(200):                                               # a flood within the minute: no spam
        clock.now += 0.25
        await writer.security("TEST_EVENT", f"flood {i}")
    assert capsys.readouterr().err.count(PREFIX) == 0
    assert len(_error_records(caplog)) == 1
    assert writer.failure_counts()["audit_log"] == 201                 # but every failure is counted

    clock.now += 61                                                    # a minute later: reported again, with the count
    await writer.security("TEST_EVENT", "later")
    err = capsys.readouterr().err
    assert err.count(PREFIX) == 1 and "202 failures so far, 201 since the last report" in err
    records = _error_records(caplog)
    assert len(records) == 2 and records[-1].fields["failures_total"] == 202
    assert records[-1].fields["where"] == "audit_log" and records[-1].ckam_stderr_done is True

    # The database still accepts system_event rows, so both reports are there for the Logs screen.
    events = await rows(SystemEvent, SystemEvent.component == "logging", SystemEvent.event == "write_failed")
    assert [e.details["failures_total"] for e in events] == [1, 202]
    assert all(e.level == "ERROR" and "audit_log" in e.message for e in events)
    assert await rows(AuditLog) == []                                  # (the audit rows themselves could not be written)


async def test_the_failing_audit_write_never_breaks_the_request(client, monkeypatch, capsys):
    await build_world()
    writer.reset_failure_reports()
    await _exhaust_audit_log_sequence()
    resp = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "wrong"})
    assert resp.status_code == 401                                     # the normal answer, not a 500
    assert capsys.readouterr().err.count(PREFIX) == 1
    events = await rows(SystemEvent, SystemEvent.event == "write_failed")
    assert len(events) == 1 and events[0].request_id == resp.headers["x-request-id"]


async def test_when_the_database_refuses_everything_nothing_raises_and_nothing_loops(monkeypatch, capsys):
    """Every insert fails (also the system_event): one report per kind, no recursion, no exception."""
    class Broken:
        def __call__(self, *args, **kwargs):
            raise ConnectionError("log database gone")

    clock = FakeClock()
    monkeypatch.setattr(writer, "_clock", clock)
    monkeypatch.setattr(writer, "core_db", SimpleNamespace(SessionLocal=Broken()))
    writer.reset_failure_reports()
    for _ in range(50):
        await writer.security("TEST_EVENT", "x")
        await writer.system("unit", "probe", "x")
    err = capsys.readouterr().err
    assert err.count(PREFIX) == 1
    assert err.count("could not write system_event (logging failure)") == 1
    assert err.count("could not write system_event (") == 2           # the plain system() write and the fallback
    counts = writer.failure_counts()
    assert counts["audit_log"] == 50 and counts["system_event"] == 50
    assert counts["system_event (logging failure)"] == 1               # tried once, at the one report


def test_report_failure_itself_never_raises(monkeypatch):
    class Unprintable(Exception):
        def __str__(self):
            raise RuntimeError("cannot even describe it")

    monkeypatch.setattr(writer.sys, "stderr", None)                    # stderr gone too
    writer.reset_failure_reports()
    assert writer.report_failure("audit_log", Unprintable()) in (True, False)
    assert writer.report_failure("error.jsonl", ValueError("x")) in (True, False)
