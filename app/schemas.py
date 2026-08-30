from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def _normalize_email(v: str) -> str:
    return v.strip().lower()


# Identificativo di account, non indirizzo di consegna: il server non invia
# posta. Volutamente NON si usa EmailStr, che rifiuta i domini special-use
# (.local, .lan, .home) — cioe' esattamente quelli di una rete domestica.
AccountEmail = Annotated[
    str,
    StringConstraints(
        min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
    AfterValidator(_normalize_email),
]


class Secure(BaseModel):
    """bytes serializzati in base64. Senza questa config Pydantic tenta di
    decodificarli in utf-8 e su ciphertext binario fallisce."""

    model_config = ConfigDict(ser_json_bytes="base64", val_json_bytes="base64")


# --------------------------------------------------------------------------- auth

class RegisterRequest(Secure):
    email: AccountEmail
    auth_key: str = Field(min_length=32, max_length=256)  # base64 di 32 byte
    kdf_salt: bytes
    kdf_memory_kib: int = Field(default=65536, ge=16384, le=1048576)
    kdf_iterations: int = Field(default=3, ge=2, le=10)
    kdf_parallelism: int = Field(default=4, ge=1, le=8)
    protected_symmetric_key: bytes
    protected_key_nonce: bytes


class RegisterResponse(BaseModel):
    id: str
    status: str
    is_admin: bool


class PreloginRequest(BaseModel):
    email: AccountEmail


class PreloginResponse(Secure):
    kdf_algorithm: str
    kdf_salt: bytes
    kdf_memory_kib: int
    kdf_iterations: int
    kdf_parallelism: int


class LoginRequest(BaseModel):
    email: AccountEmail
    auth_key: str = Field(min_length=32, max_length=256)
    device_label: str = Field(default="", max_length=64)


class TokenResponse(Secure):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    protected_symmetric_key: bytes
    protected_key_nonce: bytes
    is_admin: bool


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ChangeMasterPassword(Secure):
    """La SK non cambia: cambia solo la KEK che la wrappa. Una UPDATE atomica,
    non una ricifratura del vault."""

    current_auth_key: str
    new_auth_key: str = Field(min_length=32, max_length=256)
    new_kdf_salt: bytes
    new_kdf_memory_kib: int = Field(default=65536, ge=16384, le=1048576)
    new_kdf_iterations: int = Field(default=3, ge=2, le=10)
    new_kdf_parallelism: int = Field(default=4, ge=1, le=8)
    new_protected_symmetric_key: bytes
    new_protected_key_nonce: bytes


# ------------------------------------------------------------- kit di emergenza

class RecoverySetup(Secure):
    """Il server non sa nulla del formato del codice di recupero: 24 parole
    BIP39 o una stringa base32 sono equivalenti per lui. Vede solo la
    sottochiave di autenticazione e un blob opaco."""

    recovery_auth_key: str = Field(min_length=32, max_length=256)
    recovery_salt: bytes
    recovery_kdf_memory_kib: int = Field(default=65536, ge=16384, le=1048576)
    recovery_kdf_iterations: int = Field(default=3, ge=2, le=10)
    recovery_kdf_parallelism: int = Field(default=4, ge=1, le=8)
    recovery_key_blob: bytes
    recovery_key_nonce: bytes


class RecoveryStatus(BaseModel):
    configured: bool
    created_at: datetime | None


class RecoveryPreloginRequest(BaseModel):
    email: AccountEmail


class RecoveryPreloginResponse(Secure):
    kdf_algorithm: str
    recovery_salt: bytes
    recovery_kdf_memory_kib: int
    recovery_kdf_iterations: int
    recovery_kdf_parallelism: int


class RecoveryStartRequest(BaseModel):
    email: AccountEmail
    recovery_auth_key: str = Field(min_length=32, max_length=256)


class RecoveryStartResponse(Secure):
    recovery_token: str
    expires_in: int
    user_id: str
    recovery_key_blob: bytes
    recovery_key_nonce: bytes


class RecoveryComplete(Secure):
    """Stessi campi del cambio password, meno la vecchia auth_key: qui la prova
    di identita' l'ha gia' data il codice di recupero."""

    new_auth_key: str = Field(min_length=32, max_length=256)
    new_kdf_salt: bytes
    new_kdf_memory_kib: int = Field(default=65536, ge=16384, le=1048576)
    new_kdf_iterations: int = Field(default=3, ge=2, le=10)
    new_kdf_parallelism: int = Field(default=4, ge=1, le=8)
    new_protected_symmetric_key: bytes
    new_protected_key_nonce: bytes


class MeResponse(BaseModel):
    id: str
    email: str
    is_admin: bool
    status: str
    vault_seq: int
    storage_used_bytes: int
    storage_quota_bytes: int
    recovery_configured: bool


# --------------------------------------------------------------------------- vault

class ItemCreate(Secure):
    # L'id lo genera il CLIENT: entra nell'AAD del ciphertext, quindi deve
    # esistere prima della cifratura. Abilita anche la creazione offline.
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    item_type: str = Field(max_length=24, pattern=r"^[a-z0-9_]+$")
    nonce: bytes
    ciphertext: bytes
    wrapped_key: bytes
    wrapped_key_nonce: bytes


class ItemUpdate(ItemCreate):
    base_revision: int = Field(ge=1)


class ItemOut(Secure):
    id: str
    item_type: str
    nonce: bytes
    ciphertext: bytes
    wrapped_key: bytes
    wrapped_key_nonce: bytes
    revision: int
    seq: int
    created_at: datetime
    updated_at: datetime


class Tombstone(BaseModel):
    id: str
    seq: int
    deleted_at: datetime


class SyncResponse(Secure):
    seq: int
    items: list[ItemOut]
    files: list["FileOut"]
    tombstones: list[Tombstone]
    file_tombstones: list[Tombstone]


# --------------------------------------------------------------------------- files

class FileInit(Secure):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    item_id: str | None = None
    size_bytes: int = Field(gt=0)
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$")
    nonce: bytes
    wrapped_file_key: bytes
    wrapped_key_nonce: bytes
    metadata_ct: bytes
    metadata_nonce: bytes


class FileOut(Secure):
    id: str
    item_id: str | None
    size_bytes: int
    sha256: str
    nonce: bytes
    wrapped_file_key: bytes
    wrapped_key_nonce: bytes
    metadata_ct: bytes
    metadata_nonce: bytes
    status: str
    seq: int
    created_at: datetime


class FileInitResponse(BaseModel):
    file_id: str
    upload_url: str
    max_bytes: int


# --------------------------------------------------------------------------- admin

class AdminUserOut(BaseModel):
    """Niente chiavi wrappate, niente parametri KDF, niente ciphertext.
    L'admin amministra; non ha alcuna leva crittografica sugli altri vault."""

    id: str
    email: str
    status: str
    is_admin: bool
    created_at: datetime
    last_login_at: datetime | None
    item_count: int
    file_count: int
    storage_used_bytes: int
    storage_quota_bytes: int


class AdminStats(BaseModel):
    users_total: int
    users_active: int
    users_pending: int
    users_blocked: int
    items_total: int
    files_total: int
    storage_used_bytes: int
    db_size_bytes: int
    blobs_size_bytes: int
    disk_free_bytes: int
    disk_total_bytes: int


class QuotaUpdate(BaseModel):
    storage_quota_bytes: int = Field(ge=0)


SyncResponse.model_rebuild()
