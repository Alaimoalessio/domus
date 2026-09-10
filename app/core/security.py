import base64
import binascii
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

from app.core.config import settings

# Parametri OWASP. auth_key ha l'entropia della master password, non 256 bit:
# questo secondo stretching lato server non e' decorativo, blocca il replay
# diretto in caso di furto del database.
_hasher = PasswordHasher(
    time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID
)

# Verificare questo hash quando l'utente non esiste equalizza i tempi di risposta.
_DUMMY_HASH = _hasher.hash("dummy-value-for-timing-equalisation")


def canonical_auth_key(value: str) -> str:
    """L'auth_key viaggia come stringa base64 e viene hashata come stringa:
    senza normalizzare, la CODIFICA diventa parte della credenziale. Lo stesso
    segreto emesso con padding (base64.urlsafe_b64encode di Python) o senza
    (btoa + replace di JavaScript) produce due credenziali diverse, e un client
    non riesce ad autenticarsi su un account creato dall'altro.

    Si normalizza ai byte e si ricodifica in forma unica, cosi' alfabeto e
    padding smettono di contare."""
    text = value.strip().replace("-", "+").replace("_", "/")
    text += "=" * (-len(text) % 4)
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return value.strip()  # non e' base64: si hasha cosi' com'e'
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def hash_auth_key(auth_key_b64: str) -> str:
    return _hasher.hash(canonical_auth_key(auth_key_b64))


def verify_auth_key(stored_hash: str | None, auth_key_b64: str) -> bool:
    try:
        _hasher.verify(stored_hash or _DUMMY_HASH, canonical_auth_key(auth_key_b64))
        return stored_hash is not None
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except Exception:
        return False


def fake_kdf_salt(email: str) -> bytes:
    """Salt deterministico per email inesistenti: stessa email, stessa risposta.
    Rende /auth/prelogin inutile per enumerare gli utenti."""
    return hmac.new(
        settings.jwt_secret.encode(), b"prelogin:" + email.lower().encode(), hashlib.sha256
    ).digest()[:16]


def _token(user_id: str, security_stamp: str, scope: str, minutes: int, **extra) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": user_id,
            "sst": security_stamp,
            "scp": scope,
            "jti": secrets.token_hex(8),
            "iat": now,
            "exp": now + timedelta(minutes=minutes),
            **extra,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def create_access_token(
    user_id: str, security_stamp: str, is_admin: bool, session_id: str | None = None
) -> str:
    """`sid` lega l'access token alla sessione che lo ha emesso: senza, l'elenco
    dei dispositivi non saprebbe quale riga sia quella da cui stai guardando, e
    potresti revocare la tua stessa sessione credendo di chiuderne un'altra."""
    return _token(
        user_id,
        security_stamp,
        "access",
        settings.access_token_minutes,
        adm=is_admin,
        sid=session_id,
    )


def create_recovery_token(user_id: str, security_stamp: str) -> str:
    """Scope separato e vita breve. Vale solo per concludere il recupero: non
    apre il vault, non tocca l'admin. Chi ha il codice di carta ottiene comunque
    SK, ma non gli si regala anche una sessione piena."""
    return _token(user_id, security_stamp, "recovery", settings.recovery_token_minutes)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
