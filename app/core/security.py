import base64
import binascii
import hashlib
import hmac
import secrets
import time
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


# ============================================================ secondo fattore

_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def genera_totp_secret(byte: int = 20) -> str:
    """160 bit, la lunghezza raccomandata da RFC 4226. Base32 senza padding,
    che e' il formato che le app di autenticazione si aspettano."""
    grezzo = secrets.token_bytes(byte)
    bit = "".join(f"{b:08b}" for b in grezzo)
    return "".join(_BASE32[int(bit[i : i + 5], 2)] for i in range(0, len(bit) - 4, 5))


def _base32_decode(secret: str) -> bytes:
    pulito = "".join(c for c in secret.upper() if c in _BASE32)
    bit = "".join(f"{_BASE32.index(c):05b}" for c in pulito)
    return bytes(int(bit[i : i + 8], 2) for i in range(0, len(bit) - 7, 8))


def _hotp(chiave: bytes, contatore: int, cifre: int = 6) -> str:
    mac = hmac.new(chiave, contatore.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    valore = int.from_bytes(mac[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(valore % 10**cifre).zfill(cifre)


def verifica_totp(
    secret: str, codice: str, ultimo_contatore: int = 0, finestra: int = 1
) -> int | None:
    """Ritorna il contatore accettato, o None. La tolleranza di una finestra
    copre gli orologi leggermente sfasati; un contatore gia' usato viene
    rifiutato, cosi' un codice intercettato non si puo' rigiocare."""
    codice = codice.strip().replace(" ", "")
    if not codice.isdigit() or len(codice) != 6:
        return None

    chiave = _base32_decode(secret)
    if not chiave:
        return None

    adesso = int(time.time()) // 30
    for scarto in range(-finestra, finestra + 1):
        contatore = adesso + scarto
        if contatore <= ultimo_contatore:
            continue
        if hmac.compare_digest(_hotp(chiave, contatore), codice):
            return contatore
    return None


def uri_otpauth(secret: str, email: str, emittente: str = "Domus") -> str:
    """L'etichetta e' "emittente:account" con i due punti LETTERALI: sono il
    separatore previsto dallo schema otpauth, e codificarli in %3A fa mostrare
    ad alcune app un unico nome incollato invece di emittente e account
    distinti."""
    from urllib.parse import quote

    etichetta = f"{quote(emittente, safe='')}:{quote(email, safe='')}"
    return (
        f"otpauth://totp/{etichetta}?secret={secret}"
        f"&issuer={quote(emittente)}&algorithm=SHA1&digits=6&period=30"
    )
