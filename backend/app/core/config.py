from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://ckam:ckam_dev_pw@localhost:5432/ckam"
    jwt_secret: str = "dev_secret_change_me"
    jwt_access_minutes: int = 15
    jwt_refresh_hours: int = 8
    base_url: str = "http://localhost:8000"
    upload_dir: str = "/data/uploads"
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
