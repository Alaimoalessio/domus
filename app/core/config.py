import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VAULT_", extra="ignore")

    data_dir: Path = Path("./data")
    cors_origins: list[str] = ["http://localhost:5173"]

    jwt_secret: str = ""
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    recovery_token_minutes: int = 10

    allow_registration: bool = True
    max_users: int = 4

    # Soglia oltre la quale il blob va sul filesystem invece che dentro SQLite.
    # Sotto i ~64 KB SQLite e' piu' veloce del filesystem; sopra, SQLAlchemy
    # materializzerebbe l'intero BLOB in RAM due volte.
    inline_blob_threshold: int = 64 * 1024
    max_file_bytes: int = 100 * 1024 * 1024
    default_quota_bytes: int = 2 * 1024 * 1024 * 1024
    max_item_ciphertext: int = 256 * 1024

    gc_grace_days: int = 7
    pending_upload_hours: int = 24
    login_max_attempts: int = 8
    login_lockout_minutes: int = 15
    recovery_max_attempts: int = 5
    recovery_lockout_minutes: int = 60

    @property
    def db_path(self) -> Path:
        return self.data_dir / "vault.db"

    @property
    def blob_root(self) -> Path:
        return self.data_dir / "blobs"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.blob_root.mkdir(parents=True, exist_ok=True)
    if not s.jwt_secret:
        # Persistito: un riavvio del ThinkPad non deve sloggare tutta la famiglia.
        keyfile = s.data_dir / "jwt.key"
        if not keyfile.exists():
            keyfile.write_text(secrets.token_urlsafe(64))
            keyfile.chmod(0o600)
        s.jwt_secret = keyfile.read_text().strip()
    return s


settings = get_settings()
