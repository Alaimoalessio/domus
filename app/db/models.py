import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import (BigInteger, Boolean, ForeignKey, Index, Integer,
                        LargeBinary, String, Text)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UtcDateTime


def _uid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp() -> str:
    return secrets.token_hex(16)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)

    # Argon2id(auth_key). auth_key e' gia' derivata lato client dalla master
    # password: il server non vede ne' la password ne' la master key.
    auth_key_hash: Mapped[str] = mapped_column(Text)

    # Parametri KDF: pubblici per costruzione, servono al client PRIMA del login.
    kdf_algorithm: Mapped[str] = mapped_column(String(16), default="argon2id")
    kdf_salt: Mapped[bytes] = mapped_column(LargeBinary(16))
    kdf_memory_kib: Mapped[int] = mapped_column(Integer, default=65536)
    kdf_iterations: Mapped[int] = mapped_column(Integer, default=3)
    kdf_parallelism: Mapped[int] = mapped_column(Integer, default=4)

    # SK (chiave del vault) wrappata con la KEK. Opaca: il server non ha la KEK.
    # Tenerla separata dalla master key rende il cambio password una singola
    # UPDATE atomica invece che una ricifratura dell'intero vault.
    protected_symmetric_key: Mapped[bytes] = mapped_column(LargeBinary)
    protected_key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12))

    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|active|blocked
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Ruotarlo invalida all'istante ogni access token gia' emesso.
    security_stamp: Mapped[str] = mapped_column(String(32), default=_stamp)

    vault_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_quota_bytes: Mapped[int] = mapped_column(BigInteger, default=0)

    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime)

    # --- secondo fattore sull'accesso a Domus -----------------------------
    # Il seed TOTP e' una credenziale di autenticazione, non un dato del vault:
    # il server DEVE poterlo leggere per verificare i codici, esattamente come
    # legge l'hash di auth_key. Non intacca lo zero-knowledge, ma va detto che
    # chi ruba il database ruba anche i seed e quindi aggira il secondo fattore.
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    totp_confirmed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    #: ultimo contatore accettato: un codice gia' usato non si riusa entro la
    #: sua finestra, altrimenti chi lo intercetta ha 30 secondi per rigiocarlo
    totp_last_counter: Mapped[int] = mapped_column(BigInteger, default=0)
    totp_failed: Mapped[int] = mapped_column(Integer, default=0)
    totp_locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime)

    # --- kit di emergenza -------------------------------------------------
    # SK wrappata una seconda volta, sotto una chiave derivata dal codice di
    # recupero stampato su carta. Il codice non arriva mai al server: qui c'e'
    # solo l'hash di una sua sottochiave (per autenticare il tentativo) e un
    # blob opaco. Due strade indipendenti verso la stessa SK, entrambe cieche
    # per il server.
    recovery_salt: Mapped[bytes | None] = mapped_column(LargeBinary(16))
    recovery_kdf_memory_kib: Mapped[int | None] = mapped_column(Integer)
    recovery_kdf_iterations: Mapped[int | None] = mapped_column(Integer)
    recovery_kdf_parallelism: Mapped[int | None] = mapped_column(Integer)
    recovery_auth_hash: Mapped[str | None] = mapped_column(Text)
    recovery_key_blob: Mapped[bytes | None] = mapped_column(LargeBinary)
    recovery_key_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    recovery_created_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Contatori separati da quelli del login: altrimenti martellare il recupero
    # basterebbe a bloccare l'accesso normale della vittima.
    recovery_failed: Mapped[int] = mapped_column(Integer, default=0)
    recovery_locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime)

    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[str] = mapped_column(String(32), index=True)  # per il reuse detection
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    device_label: Mapped[str] = mapped_column(String(64), default="")
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)


class VaultItem(Base):
    __tablename__ = "vault_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # Unico metadato in chiaro, per filtri e conteggi senza decifrare.
    # Scelta consapevole: se non ti sta bene, spostalo dentro il ciphertext.
    item_type: Mapped[str] = mapped_column(String(24))

    nonce: Mapped[bytes] = mapped_column(LargeBinary(12))
    # AES-256-GCM. AAD = "pv1|<user_id>|<item_id>|<revision>": impedisce a un
    # server compromesso di spostare il ciphertext di un item dentro un altro.
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary)          # CK wrappata con SK
    wrapped_key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12))

    revision: Mapped[int] = mapped_column(Integer, default=1)   # per-item, entra nell'AAD
    seq: Mapped[int] = mapped_column(BigInteger, index=True)    # cursore di sync per utente

    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    __table_args__ = (Index("ix_items_user_seq", "user_id", "seq"),)


class FileObject(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str | None] = mapped_column(
        ForeignKey("vault_items.id", ondelete="SET NULL"), index=True
    )

    # SHA-256 del CIPHERTEXT: integrita' verificabile senza conoscere il plaintext.
    blob_hash: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    inline_data: Mapped[bytes | None] = mapped_column(LargeBinary)  # solo sotto soglia

    nonce: Mapped[bytes] = mapped_column(LargeBinary(12))
    wrapped_file_key: Mapped[bytes] = mapped_column(LargeBinary)
    wrapped_key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12))
    metadata_ct: Mapped[bytes] = mapped_column(LargeBinary)   # nome file, mime: cifrati
    metadata_nonce: Mapped[bytes] = mapped_column(LargeBinary(12))

    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|active|deleted
    seq: Mapped[int] = mapped_column(BigInteger, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    __table_args__ = (Index("ix_files_user_hash", "user_id", "blob_hash"),)


class UnlockDevice(Base):
    """Sblocco rapido con PIN su un dispositivo.

    Il PIN non basta a un ladro con il telefono in mano: la chiave che apre
    il pacchetto locale e' HKDF(pin_key || device_secret), e device_secret
    sta SOLO qui. Per averlo bisogna presentare il verifier del PIN, e dopo
    `unlock_max_failed` errori il record sparisce: si torna alla master
    password. Cosi' un PIN a 6 cifre non e' attaccabile offline, e online
    ha cinque tentativi."""

    __tablename__ = "unlock_devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    #: Argon2id(HKDF(pin_key, "pv1:pin:verify")): il server non vede mai il PIN
    verifier_hash: Mapped[str] = mapped_column(String(255))
    #: 32 byte casuali, in chiaro: da soli non aprono nulla
    device_secret: Mapped[str] = mapped_column(String(64))
    device_label: Mapped[str] = mapped_column(String(64), default="")
    failed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    event: Mapped[str] = mapped_column(String(48))
    detail: Mapped[str] = mapped_column(Text, default="")  # mai ciphertext, mai chiavi
    ip: Mapped[str] = mapped_column(String(45), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now, index=True)
