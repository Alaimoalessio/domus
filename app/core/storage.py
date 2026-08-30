import hashlib
import os
import secrets
from pathlib import Path

from anyio import to_thread

from app.core.config import settings

CHUNK = 256 * 1024


class BlobTooLarge(Exception):
    pass


class BlobMismatch(Exception):
    pass


class BlobStore:
    """Blob content-addressed, immutabili, isolati per utente.

    Il nome del file e' lo SHA-256 del CIPHERTEXT: permette al server di
    verificare l'integrita' senza conoscere il plaintext. La deduplica NON e'
    un obiettivo: in zero-knowledge due file identici, cifrati con chiavi e
    nonce diversi, producono ciphertext diversi.

    Le directory sono per utente: l'isolamento si vede con un `ls`, non serve
    leggere il codice per verificarlo, e non serve refcounting fra utenti.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    def path_for(self, user_id: str, digest: str) -> Path:
        return self.root / user_id / digest[:2] / digest[2:4] / digest

    def tmp_dir(self, user_id: str) -> Path:
        return self.root / user_id / ".tmp"

    async def write_stream(
        self, user_id: str, stream, expected_sha256: str, expected_size: int
    ) -> tuple[str, int]:
        if expected_size > settings.max_file_bytes:
            raise BlobTooLarge()

        tmp = self.tmp_dir(user_id) / secrets.token_hex(16)
        tmp.parent.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256()
        written = 0
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "wb") as fh:
                async for chunk in stream:
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > expected_size or written > settings.max_file_bytes:
                        raise BlobTooLarge()
                    digest.update(chunk)
                    await to_thread.run_sync(fh.write, chunk)
                await to_thread.run_sync(fh.flush)
                await to_thread.run_sync(os.fsync, fh.fileno())

            actual = digest.hexdigest()
            if written != expected_size or actual != expected_sha256.lower():
                raise BlobMismatch()

            final = self.path_for(user_id, actual)
            final.parent.mkdir(parents=True, exist_ok=True)
            os.replace(tmp, final)           # atomico
            os.chmod(final, 0o600)
            self._fsync_dir(final.parent)    # il rename e' durabile solo dopo questo
            return actual, written
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise

    @staticmethod
    def _fsync_dir(path: Path) -> None:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def unlink(self, user_id: str, digest: str) -> None:
        """Chiamato SOLO dal GC. I backup incrementali assumono che i blob siano
        immutabili e cancellati con ritardo: mai unlink sul path di richiesta."""
        self.path_for(user_id, digest).unlink(missing_ok=True)

    def usage_bytes(self) -> int:
        total = 0
        for p in self.root.rglob("*"):
            if p.is_file():
                total += p.stat().st_size
        return total


blob_store = BlobStore(settings.blob_root)
