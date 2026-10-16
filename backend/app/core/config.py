from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The dev-only fallback secret below is committed to this repository, so anyone
# who has read the source can forge tokens signed with it (including ADMIN
# tokens). app.main logs a loud startup WARNING whenever the running process is
# still using it -- see _warn_if_default_jwt_secret there.
DEFAULT_DEV_JWT_SECRET = "dev_secret_change_me"

# Security IF-16: the libpq names for how the ERP connection uses TLS. "prefer" is asyncpg's own default (TLS when
# the server offers it, no certificate check), i.e. exactly what CKAM always did.
ERP_SSL_MODES = ("disable", "allow", "prefer", "require", "verify-ca", "verify-full")


class Settings(BaseSettings):
    # (repr=False: a printed Settings object never shows a password or the signing key)
    database_url: str = Field(default="postgresql+asyncpg://ckam:ckam_dev_pw@localhost:5432/ckam", repr=False)
    jwt_secret: str = Field(default=DEFAULT_DEV_JWT_SECRET, repr=False)
    jwt_access_minutes: int = 15
    jwt_refresh_hours: int = 8
    # Public address of the web app (the nginx `web` service, port 3211 by
    # default) -- NOT the API's internal :8000. Printed QR labels encode
    # f"{base_url}/assets/{id}", so in production this must be the real LAN
    # hostname/IP a phone can reach, e.g. http://assets.citykart.local:3211.
    base_url: str = "http://localhost:3211"
    upload_dir: str = "/data/uploads"
    # Whether the httpOnly refresh-token cookie carries the `Secure` attribute.
    # Defaults to False because this app's deployment target is plain HTTP on a
    # LAN (docs/deployment.md): browsers never send a `Secure` cookie over HTTP,
    # which would silently break /api/auth/refresh. A real HTTPS deployment
    # should set COOKIE_SECURE=true.
    cookie_secure: bool = False
    # Set only in the single-port production deployment (no separate nginx):
    # the built frontend's `dist/` directory. When unset (dev/Docker, where
    # nginx serves the frontend on its own container), main.py's frontend
    # routes stay registered but every request falls through to a 404,
    # exactly as if they didn't exist.
    frontend_dist_dir: str | None = None
    # Read-only connection to the ERP data warehouse (PostgreSQL) that CKAM reads
    # purchase orders, vendors, receipts and PIs from. Never written to. All
    # empty = the ERP link is switched off and the ERP screens say so.
    po_source_host: str | None = None
    po_source_port: int = 5432
    po_source_db: str | None = None
    po_source_user: str | None = None
    po_source_password: str | None = Field(default=None, repr=False)
    # Security IF-16: TLS of the ERP connection (app.erp.source). PO_SOURCE_SSLMODE is one of ERP_SSL_MODES;
    # the default "prefer" keeps today's behaviour. verify-ca / verify-full check the ERP server's certificate
    # against PO_SOURCE_SSLROOTCERT (a CA file path; empty = the system's trusted certificates); verify-full
    # also checks the host name. A wrong mode stops the server at start-up with a plain message.
    po_source_sslmode: str = "prefer"
    po_source_sslrootcert: str | None = None
    # Whether this server keeps its own copy of the ERP data up to date in the background
    # (app.erp.sync). It only runs when the ERP connection above is set up.
    # The login email of a store user made from the ERP; {code} is the store's code in lower case
    # (store LAM -> sm.lam@citykartstores.com).
    store_email_pattern: str = "sm.{code}@citykartstores.com"
    erp_sync_enabled: bool = True
    erp_sync_check_minutes: int = 30
    # Security IF-10: limits on every read from the ERP warehouse (app.erp.source / app.erp.warehouse). A
    # connection that cannot be made, or a query that runs longer, becomes the friendly "ERP unavailable".
    erp_connect_timeout_seconds: int = 10
    erp_statement_timeout_seconds: int = 60
    # The background copy (app.erp.warehouse) scans the PO table (about a million rows), so it may take longer.
    erp_copy_statement_timeout_seconds: int = 120
    # Security AU-03: in-process sliding-window limits on the sign-in endpoints (app.core.rate_limit), per
    # client address (TRUSTED_PROXIES aware) and, for sign-in, per login id. Requests over the limit get 429.
    rate_limit_enabled: bool = True
    rate_limit_window_seconds: int = 60
    rate_limit_login_per_ip: int = 20
    rate_limit_login_per_login_id: int = 10
    rate_limit_refresh_per_ip: int = 60
    rate_limit_change_password_per_ip: int = 10
    # S8: logging, audit and diagnostics (app.observability; docs/ai/LOGGING_AND_DIAGNOSTICS.md).
    # LOG_DIR holds app.jsonl / error.jsonl / audit.jsonl (20 MB x 10 files each). Docker sets /data/logs
    # (the `logs` volume); a local run writes ./logs. If it cannot be written the lines go to stderr and a
    # system_event says so.
    log_level: str = "INFO"
    log_dir: str = "./logs"
    log_slow_request_ms: int = 1000
    log_slow_sql_ms: int = 500
    # error_log / system_event / client_report rows older than this are purged daily (REVIEWED client
    # reports and CRITICAL errors are kept twice as long). audit_log is never purged by the job.
    log_retention_days: int = 180
    # Comma-separated IPs / networks of reverse proxies whose X-Forwarded-For is believed. Empty (the
    # default: one uvicorn process, no proxy) = the connecting address is the client's address.
    trusted_proxies: str = ""
    # A name for this server in logs and the diagnostics bundle ("development", "production").
    # Security N4: when ENVIRONMENT_NAME is not set at all the server counts as PRODUCTION (fail closed: the
    # start-up secret check and the hidden API docs apply). Docker sets "development" (docker-compose.yml).
    environment_name: str = "production"
    # The release (git commit). Empty = GIT_COMMIT from the environment, else a VERSION file next to the
    # backend, else "unknown".
    app_version: str = ""
    model_config = SettingsConfigDict(env_file=".env")

    @field_validator("po_source_sslmode", mode="before")
    @classmethod
    def _known_ssl_mode(cls, value):
        text = "prefer" if value is None else str(value).strip().lower()
        text = text or "prefer"
        if text not in ERP_SSL_MODES:
            raise ValueError(f"PO_SOURCE_SSLMODE must be one of: {', '.join(ERP_SSL_MODES)} (the default is prefer).")
        return text

    @field_validator("po_source_sslrootcert", mode="before")
    @classmethod
    def _blank_is_none(cls, value):
        text = None if value is None else str(value).strip()
        return text or None


settings = Settings()
