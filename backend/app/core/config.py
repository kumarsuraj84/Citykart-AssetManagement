from pydantic_settings import BaseSettings, SettingsConfigDict

# The dev-only fallback secret below is committed to this repository, so anyone
# who has read the source can forge tokens signed with it (including ADMIN
# tokens). app.main logs a loud startup WARNING whenever the running process is
# still using it -- see _warn_if_default_jwt_secret there.
DEFAULT_DEV_JWT_SECRET = "dev_secret_change_me"


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://ckam:ckam_dev_pw@localhost:5432/ckam"
    jwt_secret: str = DEFAULT_DEV_JWT_SECRET
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
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
