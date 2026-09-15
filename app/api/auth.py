import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (create_access_token, create_recovery_token,
                               decode_access_token, fake_kdf_salt,
                               genera_totp_secret, hash_auth_key,
                               hash_refresh_token, needs_rehash,
                               new_refresh_token, uri_otpauth, verifica_totp,
                               verify_auth_key)
from app.db.models import RefreshToken, UnlockDevice, User
from app.deps import DB, CurrentUser, RecoveringUser, audit, bearer, utcnow
from app.schemas import (ChangeMasterPassword, LoginRequest, LogoutRequest, MeResponse,
                         PreloginRequest, PreloginResponse, RecoveryComplete,
                         RecoveryPreloginRequest, RecoveryPreloginResponse,
                         RecoveryStartRequest, RecoveryStartResponse, RecoverySetup,
                         RecoveryStatus, RefreshRequest, RegisterRequest,
                         RegisterResponse, SessionOut, TokenResponse, TotpCode,
                         TotpSetupResponse, TotpStatus, UnlockEnroll,
                         UnlockEnrollResponse, UnlockRequest, UnlockResponse)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue(db: Session, user: User, device: str, family_id: str | None = None) -> TokenResponse:
    raw, token_hash = new_refresh_token()
    session_id = uuid.uuid4().hex
    db.add(
        RefreshToken(
            id=session_id,
            user_id=user.id,
            family_id=family_id or uuid.uuid4().hex,
            token_hash=token_hash,
            device_label=device[:64],
            expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
        )
    )
    return TokenResponse(
        access_token=create_access_token(
            user.id, user.security_stamp, user.is_admin, session_id
        ),
        refresh_token=raw,
        expires_in=settings.access_token_minutes * 60,
        user_id=user.id,
        protected_symmetric_key=user.protected_symmetric_key,
        protected_key_nonce=user.protected_key_nonce,
        is_admin=user.is_admin,
    )


def _revoke_all(db: Session, user_id: str) -> None:
    for row in db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
        )
    ):
        row.revoked_at = utcnow()
    # Chi rivoca tutto lo fa perche' teme un dispositivo in mani altrui: il
    # PIN su quel dispositivo non deve sopravvivere alla rotazione.
    _forget_unlock_devices(db, user_id)


def _forget_unlock_devices(db: Session, user_id: str) -> None:
    for row in db.scalars(select(UnlockDevice).where(UnlockDevice.user_id == user_id)):
        db.delete(row)


@router.post("/register", response_model=RegisterResponse, status_code=201)
def register(payload: RegisterRequest, db: DB, request: Request):
    if not settings.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "registrazioni chiuse")

    email = payload.email.lower()
    # I bloccati non occupano un posto: altrimenti rifiutare un familiare
    # consumerebbe per sempre uno dei quattro slot.
    count = db.scalar(
        select(func.count()).select_from(User).where(User.status != "blocked")
    ) or 0
    if count >= settings.max_users:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "numero massimo di utenti raggiunto")
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email gia' registrata")

    first = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    user = User(
        email=email,
        # payload.auth_key entra qui e viene scartato: mai loggato, mai in un errore.
        auth_key_hash=hash_auth_key(payload.auth_key),
        kdf_salt=payload.kdf_salt,
        kdf_memory_kib=payload.kdf_memory_kib,
        kdf_iterations=payload.kdf_iterations,
        kdf_parallelism=payload.kdf_parallelism,
        protected_symmetric_key=payload.protected_symmetric_key,
        protected_key_nonce=payload.protected_key_nonce,
        status="active" if first else "pending",
        is_admin=first,
        storage_quota_bytes=settings.default_quota_bytes,
    )
    db.add(user)
    db.flush()
    audit(db, request, "user.register", user.id, "primo utente / admin" if first else "in attesa")
    db.commit()
    return RegisterResponse(id=user.id, status=user.status, is_admin=user.is_admin)


@router.post("/prelogin", response_model=PreloginResponse)
def prelogin(payload: PreloginRequest, db: DB):
    """Il client deve conoscere salt e parametri KDF prima di poter derivare
    qualsiasi cosa. Per email inesistenti la risposta e' deterministica e finta:
    indistinguibile da quella di un utente reale."""
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return PreloginResponse(
            kdf_algorithm=user.kdf_algorithm,
            kdf_salt=user.kdf_salt,
            kdf_memory_kib=user.kdf_memory_kib,
            kdf_iterations=user.kdf_iterations,
            kdf_parallelism=user.kdf_parallelism,
        )
    return PreloginResponse(
        kdf_algorithm="argon2id",
        kdf_salt=fake_kdf_salt(email),
        kdf_memory_kib=65536,
        kdf_iterations=3,
        kdf_parallelism=4,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DB, request: Request):
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))

    if user and user.locked_until and user.locked_until > utcnow():
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "account temporaneamente bloccato")

    # Gira anche con user=None, contro un hash dummy: tempi di risposta costanti.
    ok = verify_auth_key(user.auth_key_hash if user else None, payload.auth_key)
    if user is None or not ok:
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_attempts:
                user.locked_until = utcnow() + timedelta(minutes=settings.login_lockout_minutes)
                user.failed_logins = 0
            audit(db, request, "auth.login.fail", user.id)
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "credenziali non valide")

    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"account {user.status}")

    # Il codice si chiede DOPO aver verificato la password: chiederlo prima
    # significherebbe accettare tentativi di codice da chiunque conosca l'email.
    if user.totp_confirmed_at is not None:
        if user.totp_locked_until and user.totp_locked_until > utcnow():
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "secondo fattore temporaneamente bloccato"
            )
        if not payload.totp_code:
            # 428: la richiesta e' valida ma manca una condizione. Serve un
            # codice distinguibile da "credenziali errate", o il client non
            # saprebbe se chiedere il codice o segnalare un errore.
            raise HTTPException(
                status.HTTP_428_PRECONDITION_REQUIRED, "codice del secondo fattore richiesto"
            )
        contatore = verifica_totp(
            user.totp_secret or "", payload.totp_code, user.totp_last_counter
        )
        if contatore is None:
            user.totp_failed += 1
            if user.totp_failed >= settings.login_max_attempts:
                user.totp_locked_until = utcnow() + timedelta(
                    minutes=settings.login_lockout_minutes
                )
                user.totp_failed = 0
            audit(db, request, "auth.totp.fail", user.id)
            db.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "codice non valido")
        # Il contatore accettato viene registrato: lo stesso codice non passa
        # una seconda volta nella sua finestra.
        user.totp_last_counter = contatore
        user.totp_failed = 0
        user.totp_locked_until = None

    if needs_rehash(user.auth_key_hash):
        user.auth_key_hash = hash_auth_key(payload.auth_key)

    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    tokens = _issue(db, user, payload.device_label)
    audit(db, request, "auth.login.ok", user.id, payload.device_label)
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: DB, request: Request):
    token_hash = hash_refresh_token(payload.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token non valido")

    # Reuse detection: un token gia' ruotato che ritorna significa furto.
    # Si abbatte l'intera famiglia, non solo quel token.
    if row.revoked_at is not None:
        for sibling in db.scalars(
            select(RefreshToken).where(RefreshToken.family_id == row.family_id)
        ):
            sibling.revoked_at = sibling.revoked_at or utcnow()
        audit(db, request, "auth.refresh.reuse", row.user_id, "famiglia revocata")
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token riutilizzato")

    if row.expires_at <= utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token scaduto")

    user = db.get(User, row.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account non attivo")

    row.revoked_at = utcnow()  # rotazione
    tokens = _issue(db, user, row.device_label, family_id=row.family_id)
    db.commit()
    return tokens


@router.post("/logout", status_code=204)
def logout(payload: LogoutRequest, db: DB, user: CurrentUser):
    row = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == hash_refresh_token(payload.refresh_token),
            RefreshToken.user_id == user.id,
        )
    )
    if row and row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()


@router.post("/logout-all", status_code=204)
def logout_all(db: DB, user: CurrentUser, request: Request):
    user.security_stamp = secrets.token_hex(16)  # invalida anche gli access token vivi
    _revoke_all(db, user.id)
    audit(db, request, "auth.logout_all", user.id)
    db.commit()


# ----------------------------------------------------------- sblocco rapido
#
# Il client conserva {SK, refresh token} cifrati con HKDF(pin_key || device_secret).
# pin_key la deriva dal PIN con Argon2id; device_secret lo custodisce il server
# e lo consegna solo a chi presenta il verifier giusto, con cinque tentativi.
# Un attaccante con il telefono non puo' provare PIN offline; uno con il DB
# del server ha device_secret ma non il pacchetto cifrato, che sta sul telefono.


@router.post("/unlock/enroll", response_model=UnlockEnrollResponse, status_code=201)
def unlock_enroll(payload: UnlockEnroll, db: DB, user: CurrentUser, request: Request):
    esistenti = list(
        db.scalars(
            select(UnlockDevice)
            .where(UnlockDevice.user_id == user.id)
            .order_by(UnlockDevice.created_at)
        )
    )
    for vecchio in esistenti[: max(0, len(esistenti) - settings.unlock_max_devices + 1)]:
        db.delete(vecchio)

    device = UnlockDevice(
        user_id=user.id,
        verifier_hash=hash_auth_key(payload.verifier),
        device_secret=secrets.token_hex(32),
        device_label=payload.device_label[:64],
    )
    db.add(device)
    audit(db, request, "auth.unlock.enroll", user.id, device.device_label)
    db.commit()
    return UnlockEnrollResponse(device_id=device.id, device_secret=device.device_secret)


# Va dichiarata PRIMA di /unlock/{device_id}, o "token" verrebbe letto come id.
@router.post("/unlock/token", response_model=TokenResponse)
def unlock_token(db: DB, user: CurrentUser, request: Request):
    """Un refresh token "parcheggiato", in una famiglia tutta sua.

    Il pacchetto di sblocco deve contenere un token che la sessione viva NON
    consuma: quella ruota il proprio a ogni rinnovo, e riproporre un token
    gia' ruotato e' esattamente cio' che la reuse detection punisce
    abbattendo la famiglia. Il token parcheggiato viene speso solo allo
    sblocco, e subito rimpiazzato da uno nuovo."""
    etichetta = request.headers.get("X-Device-Label", "sblocco rapido")[:64]
    tokens = _issue(db, user, etichetta)
    db.commit()
    return tokens


@router.post("/unlock/{device_id}", response_model=UnlockResponse)
def unlock(device_id: str, payload: UnlockRequest, db: DB, request: Request):
    # Senza bearer: dopo un riavvio dell'app il refresh token sta DENTRO il
    # pacchetto che si vuole aprire. L'id del dispositivo (128 bit casuali,
    # noto solo a quel telefono) piu' il verifier sono la credenziale.
    device = db.get(UnlockDevice, device_id)
    if device is None:
        verify_auth_key(None, payload.verifier)  # stesso tempo di risposta
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sblocco rapido non attivo")

    user = db.get(User, device.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account non attivo")

    if not verify_auth_key(device.verifier_hash, payload.verifier):
        device.failed += 1
        if device.failed >= settings.unlock_max_failed:
            db.delete(device)
            audit(db, request, "auth.unlock.wiped", user.id, device.device_label)
            db.commit()
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "troppi tentativi: lo sblocco rapido e' stato disattivato",
            )
        db.commit()
        rimasti = settings.unlock_max_failed - device.failed
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"PIN errato, {rimasti} tentativi rimasti")

    device.failed = 0
    device.last_used_at = utcnow()
    db.commit()
    return UnlockResponse(device_secret=device.device_secret)


@router.delete("/unlock/{device_id}", status_code=204)
def unlock_forget(device_id: str, db: DB, user: CurrentUser):
    device = db.get(UnlockDevice, device_id)
    if device is not None and device.user_id == user.id:
        db.delete(device)
        db.commit()


@router.get("/2fa/status", response_model=TotpStatus)
def totp_status(user: CurrentUser):
    return TotpStatus(
        enabled=user.totp_confirmed_at is not None,
        pending=user.totp_secret is not None and user.totp_confirmed_at is None,
        confirmed_at=user.totp_confirmed_at,
    )


@router.post("/2fa/setup", response_model=TotpSetupResponse)
def totp_setup(db: DB, user: CurrentUser, request: Request):
    """Prepara un secret ma non attiva nulla: senza la conferma con un codice
    valido, chi sbaglia a configurare l'app resterebbe chiuso fuori."""
    if user.totp_confirmed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "secondo fattore gia' attivo")
    user.totp_secret = genera_totp_secret()
    user.totp_last_counter = 0
    audit(db, request, "auth.totp.setup", user.id)
    db.commit()
    return TotpSetupResponse(
        secret=user.totp_secret, otpauth_uri=uri_otpauth(user.totp_secret, user.email)
    )


@router.post("/2fa/activate", status_code=204)
def totp_activate(payload: TotpCode, db: DB, user: CurrentUser, request: Request):
    if user.totp_confirmed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "secondo fattore gia' attivo")
    if user.totp_secret is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "nessuna configurazione in corso")

    contatore = verifica_totp(user.totp_secret, payload.code, user.totp_last_counter)
    if contatore is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "codice non valido")

    user.totp_confirmed_at = utcnow()
    user.totp_last_counter = contatore
    audit(db, request, "auth.totp.activate", user.id)
    db.commit()


@router.post("/2fa/disable", status_code=204)
def totp_disable(payload: TotpCode, db: DB, user: CurrentUser, request: Request):
    """Disattivare richiede un codice valido: chi trova una sessione aperta non
    deve poter togliere il secondo fattore con un clic."""
    if user.totp_confirmed_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "secondo fattore non attivo")
    if verifica_totp(user.totp_secret or "", payload.code, user.totp_last_counter) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "codice non valido")

    user.totp_secret = None
    user.totp_confirmed_at = None
    user.totp_last_counter = 0
    audit(db, request, "auth.totp.disable", user.id)
    db.commit()


@router.get("/sessions", response_model=list[SessionOut])
def sessions(db: DB, user: CurrentUser, cred=Depends(bearer)):
    """I dispositivi con una sessione ancora valida. Il refresh token e' salvato
    solo come hash, quindi si riconosce la sessione corrente ricalcolandolo da
    quello presentato — non c'e' modo di risalire al token dal database."""
    attuale = None
    if cred is not None:
        payload = decode_access_token(cred.credentials)
        attuale = (payload or {}).get("sid")

    righe = db.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > utcnow(),
        )
        .order_by(RefreshToken.created_at.desc())
    )
    return [
        SessionOut(
            id=r.id,
            device_label=r.device_label or "dispositivo senza nome",
            created_at=r.created_at,
            expires_at=r.expires_at,
            current=r.id == attuale,
        )
        for r in righe
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: str, db: DB, user: CurrentUser, request: Request):
    riga = db.scalar(
        select(RefreshToken).where(
            RefreshToken.id == session_id, RefreshToken.user_id == user.id
        )
    )
    if riga is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sessione inesistente")
    if riga.revoked_at is None:
        riga.revoked_at = utcnow()
    audit(db, request, "auth.session.revoke", user.id)
    db.commit()


@router.post("/master-password", response_model=TokenResponse)
def change_master_password(
    payload: ChangeMasterPassword, db: DB, user: CurrentUser, request: Request
):
    """Cambia solo il wrapping di SK. Il vault non viene toccato: nessuna
    ricifratura di massa, nessuna finestra di inconsistenza."""
    if not verify_auth_key(user.auth_key_hash, payload.current_auth_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "master password attuale errata")

    user.auth_key_hash = hash_auth_key(payload.new_auth_key)
    user.kdf_salt = payload.new_kdf_salt
    user.kdf_memory_kib = payload.new_kdf_memory_kib
    user.kdf_iterations = payload.new_kdf_iterations
    user.kdf_parallelism = payload.new_kdf_parallelism
    user.protected_symmetric_key = payload.new_protected_symmetric_key
    user.protected_key_nonce = payload.new_protected_key_nonce
    user.security_stamp = secrets.token_hex(16)
    _revoke_all(db, user.id)

    tokens = _issue(db, user, "master-password-change")
    audit(db, request, "auth.master_password.change", user.id)
    db.commit()
    return tokens


@router.get("/me", response_model=MeResponse)
def me(user: CurrentUser):
    return MeResponse(
        id=user.id,
        email=user.email,
        is_admin=user.is_admin,
        status=user.status,
        vault_seq=user.vault_seq,
        storage_used_bytes=user.storage_used_bytes,
        storage_quota_bytes=user.storage_quota_bytes,
        recovery_configured=user.recovery_auth_hash is not None,
        totp_enabled=user.totp_confirmed_at is not None,
    )


# ============================================================================
# Kit di emergenza
#
# In una famiglia la perdita della master password non e' un rischio: e' una
# certezza. Il recupero e' una SECONDA strada verso la stessa SK, indipendente
# dalla prima e altrettanto cieca per il server:
#
#   codice di recupero (carta)
#         |
#         v  Argon2id(recovery_salt)
#      RK (32B)
#         |
#         +--> HKDF(RK, "pv1:rec:auth") --> recovery_auth_key --> al server
#         |                                 (che ne salva l'hash Argon2id)
#         +--> HKDF(RK, "pv1:rec:kek")  --> unwrap di recovery_key_blob --> SK
#
# SK non cambia durante il recupero: il foglio stampato resta valido anche
# dopo, finche' non lo si ruota esplicitamente. E' il comportamento giusto per
# un cassetto di casa — non una svista.
# ============================================================================


@router.post("/recovery/setup", status_code=204)
def recovery_setup(payload: RecoverySetup, db: DB, user: CurrentUser, request: Request):
    """Crea o ruota il kit. Sovrascrive il precedente: il vecchio foglio smette
    di funzionare, ed e' esattamente cio' che serve se lo si e' perso."""
    user.recovery_auth_hash = hash_auth_key(payload.recovery_auth_key)
    user.recovery_salt = payload.recovery_salt
    user.recovery_kdf_memory_kib = payload.recovery_kdf_memory_kib
    user.recovery_kdf_iterations = payload.recovery_kdf_iterations
    user.recovery_kdf_parallelism = payload.recovery_kdf_parallelism
    user.recovery_key_blob = payload.recovery_key_blob
    user.recovery_key_nonce = payload.recovery_key_nonce
    user.recovery_created_at = utcnow()
    user.recovery_failed = 0
    user.recovery_locked_until = None
    audit(db, request, "recovery.setup", user.id)
    db.commit()


@router.get("/recovery/status", response_model=RecoveryStatus)
def recovery_status(user: CurrentUser):
    return RecoveryStatus(
        configured=user.recovery_auth_hash is not None, created_at=user.recovery_created_at
    )


@router.delete("/recovery", status_code=204)
def recovery_delete(db: DB, user: CurrentUser, request: Request):
    user.recovery_auth_hash = None
    user.recovery_salt = None
    user.recovery_key_blob = None
    user.recovery_key_nonce = None
    user.recovery_created_at = None
    audit(db, request, "recovery.delete", user.id)
    db.commit()


@router.post("/recovery/prelogin", response_model=RecoveryPreloginResponse)
def recovery_prelogin(payload: RecoveryPreloginRequest, db: DB):
    """Parametri finti anche per un utente che ESISTE ma non ha il kit: altrimenti
    la risposta rivelerebbe chi e' recuperabile e chi no."""
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user and user.recovery_salt is not None:
        return RecoveryPreloginResponse(
            kdf_algorithm="argon2id",
            recovery_salt=user.recovery_salt,
            recovery_kdf_memory_kib=user.recovery_kdf_memory_kib,
            recovery_kdf_iterations=user.recovery_kdf_iterations,
            recovery_kdf_parallelism=user.recovery_kdf_parallelism,
        )
    return RecoveryPreloginResponse(
        kdf_algorithm="argon2id",
        recovery_salt=fake_kdf_salt("recovery:" + email),
        recovery_kdf_memory_kib=65536,
        recovery_kdf_iterations=3,
        recovery_kdf_parallelism=4,
    )


@router.post("/recovery/start", response_model=RecoveryStartResponse)
def recovery_start(payload: RecoveryStartRequest, db: DB, request: Request):
    """Il blob NON e' scaricabile da chiunque conosca l'email: prima si prova di
    conoscere il codice. Il codice ha entropia da chiave, quindi il brute force
    offline sarebbe comunque impraticabile — ma non c'e' motivo di regalare il
    materiale su cui tentarlo."""
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))

    if user and user.recovery_locked_until and user.recovery_locked_until > utcnow():
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "recupero temporaneamente bloccato"
        )

    stored = user.recovery_auth_hash if user else None
    ok = verify_auth_key(stored, payload.recovery_auth_key)   # tempi costanti anche senza kit
    if user is None or not ok:
        if user is not None:
            user.recovery_failed += 1
            if user.recovery_failed >= settings.recovery_max_attempts:
                user.recovery_locked_until = utcnow() + timedelta(
                    minutes=settings.recovery_lockout_minutes
                )
                user.recovery_failed = 0
            audit(db, request, "recovery.start.fail", user.id)
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "codice di recupero non valido")

    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"account {user.status}")

    user.recovery_failed = 0
    user.recovery_locked_until = None
    audit(db, request, "recovery.start.ok", user.id)
    db.commit()

    return RecoveryStartResponse(
        recovery_token=create_recovery_token(user.id, user.security_stamp),
        expires_in=settings.recovery_token_minutes * 60,
        user_id=user.id,
        recovery_key_blob=user.recovery_key_blob,
        recovery_key_nonce=user.recovery_key_nonce,
    )


@router.post("/recovery/complete", response_model=TokenResponse)
def recovery_complete(
    payload: RecoveryComplete, db: DB, user: RecoveringUser, request: Request
):
    """Il client ha recuperato SK dal blob e la ri-wrappa sotto la nuova master
    password. Il vault non viene toccato: cambia solo il wrapping."""
    user.auth_key_hash = hash_auth_key(payload.new_auth_key)
    user.kdf_salt = payload.new_kdf_salt
    user.kdf_memory_kib = payload.new_kdf_memory_kib
    user.kdf_iterations = payload.new_kdf_iterations
    user.kdf_parallelism = payload.new_kdf_parallelism
    user.protected_symmetric_key = payload.new_protected_symmetric_key
    user.protected_key_nonce = payload.new_protected_key_nonce
    user.security_stamp = secrets.token_hex(16)
    user.failed_logins = 0
    user.locked_until = None
    _revoke_all(db, user.id)

    tokens = _issue(db, user, "recovery")
    audit(db, request, "recovery.complete", user.id)
    db.commit()
    return tokens
