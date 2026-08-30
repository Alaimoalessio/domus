"""Garbage collector. Da cron, una volta al giorno.

Regge due invarianti da cui dipende la strategia di backup:
  - i blob sono immutabili;
  - le cancellazioni sono differite di `gc_grace_days`.
Senza il ritardo, un backup che copia il DB e poi i blob potrebbe trovare
il blob gia' sparito.
"""
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.storage import blob_store  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.models import AuditLog, FileObject, RefreshToken, VaultItem  # noqa: E402
from app.deps import utcnow  # noqa: E402


def run() -> None:
    now = utcnow()
    grace = now - timedelta(days=settings.gc_grace_days)
    stale_upload = now - timedelta(hours=settings.pending_upload_hours)
    db = SessionLocal()
    removed_blobs = removed_rows = 0

    try:
        # 1. prenotazioni di upload mai completate
        for f in db.scalars(
            select(FileObject).where(
                FileObject.status == "pending", FileObject.created_at < stale_upload
            )
        ):
            f.status = "deleted"
            f.deleted_at = now

        # 2. file cancellati oltre il periodo di grazia
        for f in list(
            db.scalars(
                select(FileObject).where(
                    FileObject.status == "deleted", FileObject.deleted_at < grace
                )
            )
        ):
            # Piu' righe dello stesso utente possono puntare allo stesso blob:
            # si cancella dal disco solo se nessuna e' ancora viva.
            still_used = db.scalar(
                select(FileObject.id).where(
                    FileObject.user_id == f.user_id,
                    FileObject.blob_hash == f.blob_hash,
                    FileObject.status != "deleted",
                )
            )
            if not still_used:
                blob_store.unlink(f.user_id, f.blob_hash)
                removed_blobs += 1
            db.delete(f)
            removed_rows += 1

        # 3. tombstone degli item, dopo che tutti i dispositivi hanno sincronizzato
        for i in db.scalars(
            select(VaultItem).where(
                VaultItem.deleted_at.is_not(None), VaultItem.deleted_at < grace
            )
        ):
            db.delete(i)

        # 4. refresh token scaduti o revocati
        for t in db.scalars(
            select(RefreshToken).where(RefreshToken.expires_at < now)
        ):
            db.delete(t)

        # 5. audit log oltre i 180 giorni
        for a in db.scalars(
            select(AuditLog).where(AuditLog.created_at < now - timedelta(days=180))
        ):
            db.delete(a)

        # 6. temporanei orfani di upload interrotti
        for user_dir in settings.blob_root.iterdir():
            tmp = user_dir / ".tmp"
            if tmp.is_dir():
                for leftover in tmp.iterdir():
                    if leftover.is_file():
                        leftover.unlink(missing_ok=True)

        db.commit()
        print(f"gc: {removed_rows} righe file rimosse, {removed_blobs} blob cancellati dal disco")
    finally:
        db.close()


if __name__ == "__main__":
    run()
