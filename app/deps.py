from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.base import SessionLocal
from app.db.models import AuditLog, User

bearer = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


def _user_from_token(db: Session, cred, expected_scope: str) -> User:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token mancante")

    payload = decode_access_token(cred.credentials)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token non valido")

    # Lo scope non e' decorativo: senza questo controllo un token di recupero
    # varrebbe come sessione piena su tutta l'API.
    if payload.get("scp") != expected_scope:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "scope del token errato")

    user = db.get(User, payload.get("sub"))
    # Lo stamp invalida ogni token in circolazione su blocco o cambio password.
    if user is None or user.security_stamp != payload.get("sst"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessione revocata")
    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"account {user.status}")
    return user


def get_current_user(
    db: DB,
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    return _user_from_token(db, cred, "access")


def get_recovering_user(
    db: DB,
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    return _user_from_token(db, cred, "recovery")


CurrentUser = Annotated[User, Depends(get_current_user)]
RecoveringUser = Annotated[User, Depends(get_recovering_user)]


def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "riservato all'admin")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def next_seq(user: User) -> int:
    """Cursore di sync monotono, per utente."""
    user.vault_seq += 1
    return user.vault_seq


def audit(db: Session, request: Request, event: str, user_id: str | None, detail: str = "") -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            event=event,
            detail=detail[:512],
            ip=request.client.host if request.client else "",
        )
    )


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
