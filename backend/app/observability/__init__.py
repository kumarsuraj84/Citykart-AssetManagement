"""S8: audit trail, logging and diagnostics.

* `context`   -- the request id and who / where / what of the running request or background job.
* `redact`    -- removes secrets (by key name and by value pattern) before anything is stored or logged.
* `models`    -- audit_log, error_log, system_event, client_report.
* `audit`     -- data audit rows written in the business transaction (automatic for ORM changes of the
                 business tables, plus explicit one-row summaries of bulk actions).
* `writer`    -- security / access / error / system rows written in their own short session, so they
                 survive a request that is rolled back. Never raises.
* `filelog`   -- JSON-lines files (app.jsonl, error.jsonl, audit.jsonl) in LOG_DIR.
* `middleware`-- request id, access log, slow requests, unhandled errors.
See docs/ai/LOGGING_AND_DIAGNOSTICS.md."""
