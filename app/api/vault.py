from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.core.config import settings
from app.db.models import FileObject, VaultItem
from app.deps import DB, CurrentUser, audit, next_seq, utcnow
from app.schemas import (FileOut, ItemCreate, ItemOut, ItemUpdate, SyncResponse,
                         Tombstone, TrashItem)

router = APIRouter(prefix="/vault", tags=["vault"])


def _to_out(item: VaultItem) -> ItemOut:
    return ItemOut(
        id=item.id,
        item_type=item.item_type,
        nonce=item.nonce,
        ciphertext=item.ciphertext,
        wrapped_key=item.wrapped_key,
        wrapped_key_nonce=item.wrapped_key_nonce,
        revision=item.revision,
        seq=item.seq,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _file_out(f: FileObject) -> FileOut:
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


def _owned(db, user, item_id: str) -> VaultItem:
    """Ogni lettura passa da qui: il filtro su user_id non e' opzionale.
    E' cosi' che l'isolamento fra vault resta una proprieta' del codice e non
    una convenzione che qualcuno prima o poi dimentica."""
    item = db.scalar(
        select(VaultItem).where(VaultItem.id == item_id, VaultItem.user_id == user.id)
    )
    if item is None or item.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item inesistente")
    return item


@router.get("/sync", response_model=SyncResponse)
def sync(db: DB, user: CurrentUser, since: int = Query(default=0, ge=0)):
    """Sync incrementale a cursore. Il server non puo' fare merge: non sa cosa
    starebbe unendo. I conflitti li risolve il client."""
    rows = list(
        db.scalars(
            select(VaultItem)
            .where(VaultItem.user_id == user.id, VaultItem.seq > since)
            .order_by(VaultItem.seq)
        )
    )
    files = list(
        db.scalars(
            select(FileObject)
            .where(
                FileObject.user_id == user.id,
                FileObject.seq > since,
                FileObject.status != "pending",
            )
            .order_by(FileObject.seq)
        )
    )
    return SyncResponse(
        seq=user.vault_seq,
        items=[_to_out(i) for i in rows if i.deleted_at is None],
        files=[_file_out(f) for f in files if f.status == "active"],
        tombstones=[
            Tombstone(id=i.id, seq=i.seq, deleted_at=i.deleted_at)
            for i in rows
            if i.deleted_at is not None
        ],
        file_tombstones=[
            Tombstone(id=f.id, seq=f.seq, deleted_at=f.deleted_at)
            for f in files
            if f.status == "deleted"
        ],
    )


@router.get("/trash", response_model=list[TrashItem])
def trash(db: DB, user: CurrentUser):
    """Voci cancellate ancora recuperabili. Oltre il periodo di grazia il GC le
    rimuove davvero, quindi qui si mostra solo cio' che esiste ancora."""
    limite = utcnow() - timedelta(days=settings.gc_grace_days)
    righe = db.scalars(
        select(VaultItem)
        .where(
            VaultItem.user_id == user.id,
            VaultItem.deleted_at.is_not(None),
            VaultItem.deleted_at > limite,
        )
        .order_by(VaultItem.deleted_at.desc())
    )
    out = []
    for i in righe:
        allegati = db.scalar(
            select(func.count()).select_from(FileObject).where(
                FileObject.item_id == i.id,
                FileObject.user_id == user.id,
                FileObject.deleted_at == i.deleted_at,
            )
        ) or 0
        out.append(
            TrashItem(
                id=i.id,
                item_type=i.item_type,
                nonce=i.nonce,
                ciphertext=i.ciphertext,
                wrapped_key=i.wrapped_key,
                wrapped_key_nonce=i.wrapped_key_nonce,
                revision=i.revision,
                deleted_at=i.deleted_at,
                attachments=allegati,
            )
        )
    return out


@router.post("/items/{item_id}/restore", response_model=ItemOut)
def restore_item(item_id: str, db: DB, user: CurrentUser, request: Request):
    """Riporta indietro una voce e gli allegati cancellati NELLO STESSO
    momento: un allegato eliminato prima, di proposito, non deve tornare."""
    item = db.scalar(
        select(VaultItem).where(VaultItem.id == item_id, VaultItem.user_id == user.id)
    )
    if item is None or item.deleted_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "voce non nel cestino")
    if item.deleted_at <= utcnow() - timedelta(days=settings.gc_grace_days):
        raise HTTPException(status.HTTP_410_GONE, "periodo di recupero scaduto")

    allegati = list(
        db.scalars(
            select(FileObject).where(
                FileObject.item_id == item.id,
                FileObject.user_id == user.id,
                FileObject.status == "deleted",
                FileObject.deleted_at == item.deleted_at,
            )
        )
    )
    da_riprendere = sum(f.size_bytes for f in allegati)
    if user.storage_used_bytes + da_riprendere > user.storage_quota_bytes:
        raise HTTPException(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            "quota insufficiente per ripristinare gli allegati",
        )

    item.deleted_at = None
    item.seq = next_seq(user)
    for f in allegati:
        f.status = "active"
        f.deleted_at = None
        f.seq = next_seq(user)
        user.storage_used_bytes += f.size_bytes

    audit(db, request, "vault.item.restore", user.id, f"allegati: {len(allegati)}")
    db.commit()
    return _to_out(item)


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(payload: ItemCreate, db: DB, user: CurrentUser):
    if len(payload.ciphertext) > settings.max_item_ciphertext:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "item troppo grande")

    if db.get(VaultItem, payload.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "id gia' esistente")

    item = VaultItem(
        id=payload.id,
        user_id=user.id,
        item_type=payload.item_type,
        nonce=payload.nonce,
        ciphertext=payload.ciphertext,
        wrapped_key=payload.wrapped_key,
        wrapped_key_nonce=payload.wrapped_key_nonce,
        revision=1,
        seq=next_seq(user),
    )
    db.add(item)
    db.commit()
    return _to_out(item)


@router.get("/items/{item_id}", response_model=ItemOut)
def get_item(item_id: str, db: DB, user: CurrentUser):
    return _to_out(_owned(db, user, item_id))


@router.put("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: str, payload: ItemUpdate, db: DB, user: CurrentUser):
    if len(payload.ciphertext) > settings.max_item_ciphertext:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "item troppo grande")

    item = _owned(db, user, item_id)

    # Concorrenza ottimistica. La revision e' anche dentro l'AAD del ciphertext:
    # accettare una base sbagliata renderebbe l'item indecifrabile.
    if payload.base_revision != item.revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"conflitto: revision sul server {item.revision}, inviata {payload.base_revision}",
        )

    item.item_type = payload.item_type
    item.nonce = payload.nonce
    item.ciphertext = payload.ciphertext
    item.wrapped_key = payload.wrapped_key
    item.wrapped_key_nonce = payload.wrapped_key_nonce
    item.revision += 1
    item.seq = next_seq(user)
    item.updated_at = utcnow()
    db.commit()
    return _to_out(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: str, db: DB, user: CurrentUser, request: Request):
    """Soft delete: il tombstone serve agli altri dispositivi per propagare la
    cancellazione. Lo spazio lo recupera il GC."""
    item = _owned(db, user, item_id)
    now = utcnow()
    item.deleted_at = now
    # Il ciphertext NON viene azzerato: resta per il periodo di grazia, cosi'
    # una cancellazione per sbaglio si puo' annullare. Lo elimina il GC insieme
    # al tombstone. Per il server resta ciphertext opaco come qualunque altro.
    item.seq = next_seq(user)

    # Gli allegati seguono l'item. Senza questo restavano attivi per sempre:
    # invisibili nell'interfaccia (che li mostra solo dentro il loro item),
    # non cancellabili, e con la quota occupata a vita.
    orfani = 0
    for f in db.scalars(
        select(FileObject).where(
            FileObject.item_id == item.id,
            FileObject.user_id == user.id,
            FileObject.status.in_(("active", "pending")),
        )
    ):
        if f.status == "active":
            user.storage_used_bytes = max(0, user.storage_used_bytes - f.size_bytes)
        f.status = "deleted"
        f.deleted_at = now
        # inline_data NON viene azzerato: sotto i 64 KB il contenuto sta qui e
        # non sul filesystem, quindi cancellarlo renderebbe il ripristino una
        # bugia — la riga tornerebbe indietro vuota. Lo elimina il GC.
        f.seq = next_seq(user)
        orfani += 1

    audit(db, request, "vault.item.delete", user.id, f"allegati rimossi: {orfani}")
    db.commit()
