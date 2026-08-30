import hashlib

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.core.config import settings
from app.core.storage import BlobMismatch, BlobTooLarge, blob_store
from app.db.models import FileObject, VaultItem
from app.deps import DB, CurrentUser, audit, next_seq, utcnow
from app.schemas import FileInit, FileInitResponse, FileOut

router = APIRouter(prefix="/files", tags=["files"])

DOWNLOAD_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}


def _out(f: FileObject) -> FileOut:
    return FileOut(
        id=f.id,
        item_id=f.item_id,
        size_bytes=f.size_bytes,
        sha256=f.blob_hash,
        nonce=f.nonce,
        wrapped_file_key=f.wrapped_file_key,
        wrapped_key_nonce=f.wrapped_key_nonce,
        metadata_ct=f.metadata_ct,
        metadata_nonce=f.metadata_nonce,
        status=f.status,
        seq=f.seq,
        created_at=f.created_at,
    )


def _owned(db, user, file_id: str, *, statuses: tuple[str, ...]) -> FileObject:
    f = db.scalar(select(FileObject).where(FileObject.id == file_id, FileObject.user_id == user.id))
    if f is None or f.status not in statuses:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file inesistente")
    return f


@router.get("", response_model=list[FileOut])
def list_files(db: DB, user: CurrentUser):
    rows = db.scalars(
        select(FileObject)
        .where(FileObject.user_id == user.id, FileObject.status == "active")
        .order_by(FileObject.created_at)
    )
    return [_out(f) for f in rows]


@router.post("/init", response_model=FileInitResponse, status_code=201)
def init_upload(payload: FileInit, db: DB, user: CurrentUser):
    """Fase 1: si prenota lo spazio PRIMA di accettare byte. Una fase sola
    significherebbe riempire il disco e poi fare rollback."""
    if payload.size_bytes > settings.max_file_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"limite per file: {settings.max_file_bytes} byte",
        )

    if payload.item_id is not None:
        owner = db.scalar(
            select(VaultItem.id).where(
                VaultItem.id == payload.item_id,
                VaultItem.user_id == user.id,
                VaultItem.deleted_at.is_(None),
            )
        )
        if owner is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item inesistente")

    # Nella quota contano anche le prenotazioni ancora aperte, o due upload
    # paralleli sfondano il limite.
    reserved = db.scalar(
        select(func.coalesce(func.sum(FileObject.size_bytes), 0)).where(
            FileObject.user_id == user.id, FileObject.status == "pending"
        )
    ) or 0
    if user.storage_used_bytes + reserved + payload.size_bytes > user.storage_quota_bytes:
        raise HTTPException(status.HTTP_507_INSUFFICIENT_STORAGE, "quota esaurita")

    if db.get(FileObject, payload.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "id gia' esistente")

    f = FileObject(
        id=payload.id,
        user_id=user.id,
        item_id=payload.item_id,
        blob_hash=payload.sha256.lower(),
        size_bytes=payload.size_bytes,
        nonce=payload.nonce,
        wrapped_file_key=payload.wrapped_file_key,
        wrapped_key_nonce=payload.wrapped_key_nonce,
        metadata_ct=payload.metadata_ct,
        metadata_nonce=payload.metadata_nonce,
        status="pending",
    )
    db.add(f)
    db.commit()
    return FileInitResponse(
        file_id=f.id,
        upload_url=f"/api/v1/files/{f.id}/content",
        max_bytes=settings.max_file_bytes,
    )


@router.put("/{file_id}/content", response_model=FileOut)
async def upload_content(file_id: str, request: Request, db: DB, user: CurrentUser):
    """Fase 2: il corpo grezzo (application/octet-stream) scorre a chunk.
    Hash e dimensione sono verificati mentre passa, non dopo."""
    f = _owned(db, user, file_id, statuses=("pending",))

    small = f.size_bytes <= settings.inline_blob_threshold
    try:
        if small:
            # Sotto soglia SQLite batte il filesystem, e la RAM impegnata e' nota.
            buf = bytearray()
            async for chunk in request.stream():
                buf.extend(chunk)
                if len(buf) > f.size_bytes:
                    raise BlobTooLarge()
            data = bytes(buf)
            if len(data) != f.size_bytes or hashlib.sha256(data).hexdigest() != f.blob_hash:
                raise BlobMismatch()
            f.inline_data = data
            written = len(data)
        else:
            _, written = await blob_store.write_stream(
                user.id, request.stream(), f.blob_hash, f.size_bytes
            )
    except BlobTooLarge:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "dimensione eccedente")
    except BlobMismatch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "hash o dimensione non coincidono")

    f.status = "active"
    f.seq = next_seq(user)
    user.storage_used_bytes += written
    audit(db, request, "file.upload", user.id, f"{written} byte")
    db.commit()
    return _out(f)


@router.get("/{file_id}/content")
def download_content(file_id: str, db: DB, user: CurrentUser):
    """Restituisce ciphertext opaco. Il nome vero del file e' cifrato dentro
    metadata_ct: qui si serve solo un id, niente nomi attaccabili."""
    f = _owned(db, user, file_id, statuses=("active",))
    headers = {
        **DOWNLOAD_HEADERS,
        "Content-Disposition": f'attachment; filename="{f.id}.bin"',
        "X-Blob-SHA256": f.blob_hash,
    }

    if f.inline_data is not None:
        return Response(
            content=f.inline_data, media_type="application/octet-stream", headers=headers
        )

    path = blob_store.path_for(user.id, f.blob_hash)
    if not path.is_file():
        raise HTTPException(status.HTTP_410_GONE, "blob non presente sul server")
    return FileResponse(path, media_type="application/octet-stream", headers=headers)


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str, db: DB, user: CurrentUser, request: Request):
    """Tombstone, non unlink. I backup incrementali assumono blob immutabili e
    cancellazioni differite: al disco ci pensa il GC dopo il periodo di grazia."""
    f = _owned(db, user, file_id, statuses=("active", "pending"))
    if f.status == "active":
        user.storage_used_bytes = max(0, user.storage_used_bytes - f.size_bytes)
    f.status = "deleted"
    f.deleted_at = utcnow()
    f.inline_data = None
    f.seq = next_seq(user)
    audit(db, request, "file.delete", user.id)
    db.commit()
