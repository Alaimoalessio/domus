import secrets
import shutil

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.core.config import settings
from app.core.storage import blob_store
from app.db.models import AuditLog, FileObject, RefreshToken, User, VaultItem
from app.deps import DB, AdminUser, audit, utcnow
from app.schemas import AdminStats, AdminUserOut, QuotaUpdate

router = APIRouter(prefix="/admin", tags=["admin"])

# Nota architetturale: nessun endpoint di questo modulo legge `ciphertext`,
# `protected_symmetric_key`, `wrapped_key` o `inline_data`. L'admin conta e
# amministra; non ha alcuna leva crittografica sui vault altrui. Non e' una
# policy applicata a runtime, e' l'assenza fisica delle chiavi: la KEK di ogni
# utente esiste solo sul suo dispositivo.


def _counts(db, user_id: str) -> tuple[int, int]:
    items = db.scalar(
        select(func.count()).select_from(VaultItem).where(
            VaultItem.user_id == user_id, VaultItem.deleted_at.is_(None)
        )
    ) or 0
    files = db.scalar(
        select(func.count()).select_from(FileObject).where(
            FileObject.user_id == user_id, FileObject.status == "active"
        )
    ) or 0
    return items, files


@router.get("/stats", response_model=AdminStats)
def stats(db: DB, admin: AdminUser):
    by_status = dict(
        db.execute(select(User.status, func.count()).group_by(User.status)).all()
    )
    usage = shutil.disk_usage(settings.data_dir)
    db_size = settings.db_path.stat().st_size if settings.db_path.exists() else 0

    return AdminStats(
        users_total=sum(by_status.values()),
        users_active=by_status.get("active", 0),
        users_pending=by_status.get("pending", 0),
        users_blocked=by_status.get("blocked", 0),
        items_total=db.scalar(
            select(func.count()).select_from(VaultItem).where(VaultItem.deleted_at.is_(None))
        ) or 0,
        files_total=db.scalar(
            select(func.count()).select_from(FileObject).where(FileObject.status == "active")
        ) or 0,
        storage_used_bytes=db.scalar(
            select(func.coalesce(func.sum(User.storage_used_bytes), 0))
        ) or 0,
        db_size_bytes=db_size,
        blobs_size_bytes=blob_store.usage_bytes(),
        disk_free_bytes=usage.free,
        disk_total_bytes=usage.total,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(db: DB, admin: AdminUser):
    out = []
    for u in db.scalars(select(User).order_by(User.created_at)):
        items, files = _counts(db, u.id)
        out.append(
            AdminUserOut(
                id=u.id,
                email=u.email,
                status=u.status,
                is_admin=u.is_admin,
                created_at=u.created_at,
                last_login_at=u.last_login_at,
                item_count=items,
                file_count=files,
                storage_used_bytes=u.storage_used_bytes,
                storage_quota_bytes=u.storage_quota_bytes,
            )
        )
    return out


def _target(db, user_id: str) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "utente inesistente")
    return u


@router.post("/users/{user_id}/approve", status_code=204)
def approve(user_id: str, db: DB, admin: AdminUser, request: Request):
    u = _target(db, user_id)
    if u.status == "active":
        return
    u.status = "active"
    audit(db, request, "admin.user.approve", admin.id, f"target={u.id}")
    db.commit()


@router.post("/users/{user_id}/block", status_code=204)
def block(user_id: str, db: DB, admin: AdminUser, request: Request):
    u = _target(db, user_id)
    if u.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "non puoi bloccare te stesso")

    u.status = "blocked"
    u.security_stamp = secrets.token_hex(16)  # taglia le sessioni gia' aperte
    for row in db.scalars(
        select(RefreshToken).where(RefreshToken.user_id == u.id, RefreshToken.revoked_at.is_(None))
    ):
        row.revoked_at = utcnow()
    audit(db, request, "admin.user.block", admin.id, f"target={u.id}")
    db.commit()


@router.post("/users/{user_id}/quota", status_code=204)
def set_quota(user_id: str, payload: QuotaUpdate, db: DB, admin: AdminUser, request: Request):
    u = _target(db, user_id)
    u.storage_quota_bytes = payload.storage_quota_bytes
    audit(db, request, "admin.user.quota", admin.id, f"target={u.id} quota={payload.storage_quota_bytes}")
    db.commit()


@router.get("/audit")
def read_audit(db: DB, admin: AdminUser, limit: int = Query(default=100, le=500)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit))
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "event": r.event,
            "detail": r.detail,
            "ip": r.ip,
            "created_at": r.created_at,
        }
        for r in rows
    ]
