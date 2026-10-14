"""JSON-lines log files in LOG_DIR, through the standard logging module (no extra dependency).

* app.jsonl   -- one access line per request (logger "ckam.access") and every application message of the
                 "ckam" loggers at LOG_LEVEL and above;
* error.jsonl -- WARNING and above of the "ckam" loggers, with stacks;
* audit.jsonl -- a copy of every audit_log row (logger "ckam.audit"), for shipping off the server.
Each file rotates at 20 MB and keeps 10 old files. Every line is redacted (app.observability.redact) and
carries the request id of the request / job it belongs to.

If LOG_DIR cannot be created or written, the same JSON lines go to stderr instead and `problem()` says
why (the startup writes that into system_event). uvicorn's own access log is switched off, so there is
exactly one access line per request (ours, with the request id, actor and route)."""
from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.observability import context
from app.observability.redact import redact, redact_text

MAX_BYTES = 20 * 1024 * 1024
BACKUP_COUNT = 10
FILES = ("app.jsonl", "error.jsonl", "audit.jsonl")

ROOT = "ckam"
ACCESS = "ckam.access"
AUDIT = "ckam.audit"

_state: dict = {"dir": None, "problem": None, "configured": False}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
        }
        ctx = context.current()
        if ctx is not None:
            data["request_id"] = ctx.request_id
            if ctx.actor_id is not None:
                data["actor_id"] = ctx.actor_id
            if ctx.source != "api":
                data["source"] = ctx.source
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            data.update(redact(fields))
        try:
            message = record.getMessage()
        except Exception:                      # a bad %-format must not lose the line
            message = str(record.msg)
        if message:
            data["msg"] = redact_text(message, 4000)
        if record.exc_info:
            data["stack"] = redact_text(self.formatException(record.exc_info), 20000)
        return json.dumps(data, default=str, ensure_ascii=False)


class _PlainStderr(logging.Formatter):
    def __init__(self):
        super().__init__("%(levelname)s:     [%(name)s] %(message)s")

    def format(self, record):
        return redact_text(super().format(record), 20000)


def _mark(handler: logging.Handler) -> logging.Handler:
    handler._ckam = True          # type: ignore[attr-defined]
    return handler


def _remove_ours(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        if getattr(handler, "_ckam", False):
            logger.removeHandler(handler)
            try:
                handler.close()
            except Exception:
                pass


def _writable(directory: Path) -> str | None:
    """None when the directory exists (made if missing) and a file can be written there, else why not."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".write-test"
        with open(probe, "a", encoding="utf-8") as fh:
            fh.write("")
        probe.unlink(missing_ok=True)
        return None
    except Exception as exc:                   # PermissionError, OSError, read-only volume ...
        return f"{type(exc).__name__}: {exc}"


def setup(log_dir: str, level: str = "INFO") -> None:
    """(Re)configures the ckam loggers. Safe to call again (tests point it at a temporary directory)."""
    root = logging.getLogger(ROOT)
    audit = logging.getLogger(AUDIT)
    _remove_ours(root)
    _remove_ours(audit)
    for name in ("ckam.security",):             # main.py used to give this one its own stderr handler
        legacy = logging.getLogger(name)
        for handler in list(legacy.handlers):
            if isinstance(handler, logging.StreamHandler) and not getattr(handler, "_ckam", False):
                legacy.removeHandler(handler)

    numeric = logging.getLevelName(str(level).upper())
    root.setLevel(numeric if isinstance(numeric, int) else logging.INFO)
    root.propagate = True          # pytest's caplog listens on the root logger
    audit.setLevel(logging.INFO)
    audit.propagate = False        # audit lines go only to audit.jsonl
    logging.getLogger(ACCESS).setLevel(logging.INFO)   # access lines whatever LOG_LEVEL says

    formatter = JsonFormatter()
    directory = Path(log_dir).expanduser()
    problem = _writable(directory)
    _state.update(dir=str(directory.resolve()) if problem is None else str(directory), problem=problem)

    if problem is None:
        def rotating(name: str, lvl: int) -> logging.Handler:
            handler = logging.handlers.RotatingFileHandler(
                directory / name, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8", delay=True)
            handler.setLevel(lvl)
            handler.setFormatter(formatter)
            return _mark(handler)

        root.addHandler(rotating("app.jsonl", logging.DEBUG))
        root.addHandler(rotating("error.jsonl", logging.WARNING))
        audit.addHandler(rotating("audit.jsonl", logging.INFO))
    else:
        fallback = logging.StreamHandler(sys.stderr)
        fallback.setFormatter(formatter)
        fallback.setLevel(logging.INFO)
        root.addHandler(_mark(fallback))
        audit_fallback = logging.StreamHandler(sys.stderr)
        audit_fallback.setFormatter(formatter)
        audit.addHandler(_mark(audit_fallback))

    # Problems (WARNING and above) also on stderr in the classic one-line form, so `docker compose logs
    # api` and the production launcher log still show them. Skipped in the fallback (already on stderr).
    if problem is None:
        console = logging.StreamHandler(sys.stderr)
        console.setLevel(logging.WARNING)
        console.setFormatter(_PlainStderr())
        root.addHandler(_mark(console))

    # One access line per request: ours (app.observability.middleware), not uvicorn's.
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.disabled = True
    uvicorn_access.propagate = False
    _state["configured"] = True


def problem() -> str | None:
    """Why LOG_DIR could not be used (None when the files are being written)."""
    return _state["problem"]


def directory() -> str | None:
    return _state["dir"]


def writable_now() -> bool:
    d = _state["dir"]
    return d is not None and _state["problem"] is None and _writable(Path(d)) is None


def log_files() -> dict[str, list[str]]:
    """The current and rotated files of each log, newest first."""
    d = _state["dir"]
    out: dict[str, list[str]] = {}
    if not d or _state["problem"] is not None:
        return out
    for name in FILES:
        paths = [os.path.join(d, name)] + [os.path.join(d, f"{name}.{i}") for i in range(1, BACKUP_COUNT + 1)]
        out[name] = [p for p in paths if os.path.exists(p)]
    return out


def find_lines(name: str, needle: str, max_files: int = 2, max_lines: int = 20) -> list[dict]:
    """Lines of one log (current file and the newest rotated one) that contain `needle` (a request id)."""
    found: list[dict] = []
    if not needle:
        return found
    for path in log_files().get(name, [])[:max_files]:
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if needle in line:
                        try:
                            found.append(json.loads(line))
                        except ValueError:
                            found.append({"raw": line.strip()[:2000]})
                        if len(found) >= max_lines:
                            return found
        except OSError:
            continue
    return found


access_logger = logging.getLogger(ACCESS)
audit_logger = logging.getLogger(AUDIT)
