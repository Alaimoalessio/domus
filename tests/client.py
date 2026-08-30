"""Client di riferimento: TUTTA la crittografia sta qui.

Questo file e' la specifica eseguibile per il frontend. Il server non importa
mai `cryptography`: non ha nulla da cifrare e nessuna chiave con cui farlo.

    master_password
          |
          v  Argon2id(salt=kdf_salt)                    [solo client]
       MK (32B) --- non lascia mai il dispositivo
          |
          +--> HKDF(MK, "pv1:auth") --> auth_key --> al server (che la ri-hasha)
          |
          +--> HKDF(MK, "pv1:kek")  --> KEK --unwrap--> SK (chiave del vault)
"""
import base64
import json
import os
import uuid

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

DEFAULT_KDF = {"kdf_memory_kib": 65536, "kdf_iterations": 3, "kdf_parallelism": 4}


# FORMATO DI TRASPORTO: base64 URL-SAFE (alfabeto -_), con padding.
# E' quello che Pydantic emette con ser_json_bytes="base64"; in ingresso
# accetta anche l'alfabeto standard, ma in uscita no. Il frontend deve
# decodificare url-safe, o su ~1 blob su 2 trovera' un carattere non valido.
def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode()


def unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def derive_master_key(password: str, salt: bytes, params: dict) -> bytes:
    return hash_secret_raw(
        secret=password.encode(),
        salt=salt,
        time_cost=params["kdf_iterations"],
        memory_cost=params["kdf_memory_kib"],
        parallelism=params["kdf_parallelism"],
        hash_len=32,
        type=Type.ID,
    )


def subkey(master_key: bytes, info: str) -> bytes:
    """Domain separation: auth_key non rivela nulla su KEK e viceversa."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info.encode()).derive(
        master_key
    )


def seal(key: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)
    return nonce, AESGCM(key).encrypt(nonce, plaintext, aad)


def open_(key: bytes, nonce: bytes, ct: bytes, aad: bytes) -> bytes:
    return AESGCM(key).decrypt(nonce, ct, aad)


def genera_codice_recupero() -> str:
    """160 bit in base32, in gruppi di 4: 'K3M9-...' x8.

    Il server e' agnostico sul formato — vede solo una sottochiave derivata e un
    blob. Sostituire questo con 24 parole BIP39 e' un cambio puramente lato
    client, senza toccare una riga di backend.
    """
    grezzo = base64.b32encode(os.urandom(20)).decode().rstrip("=")
    return "-".join(grezzo[i:i + 4] for i in range(0, len(grezzo), 4))


def normalizza_codice(codice: str) -> str:
    """Chi lo ridigita dal foglio non deve indovinare trattini e maiuscole."""
    return "".join(c for c in codice.upper() if c.isalnum())


def item_aad(user_id: str, item_id: str, revision: int) -> bytes:
    """Lega il ciphertext alla sua riga. Senza questo, un server compromesso
    potrebbe spostare il ciphertext dell'item A nella riga dell'item B: il
    client decifrerebbe senza errori e mostrerebbe la password sbagliata sul
    dominio sbagliato. Con l'AAD, quello scambio fallisce la verifica GCM."""
    return f"pv1|{user_id}|{item_id}|{revision}".encode()


def file_aad(user_id: str, file_id: str) -> bytes:
    return f"pv1f|{user_id}|{file_id}".encode()


def meta_aad(user_id: str, file_id: str) -> bytes:
    return f"pv1fm|{user_id}|{file_id}".encode()


class VaultClient:
    """Stateful quanto basta: SK vive solo in memoria, mai su disco."""

    def __init__(self, http, base: str = "/api/v1"):
        self.http = http
        self.base = base
        self.sk: bytes | None = None
        self.user_id: str | None = None
        self.access: str | None = None
        self.refresh_token: str | None = None

    # ----------------------------------------------------------------- http
    @property
    def auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.access}"}

    def _store(self, data: dict, master_key: bytes) -> None:
        self.access = data["access_token"]
        self.refresh_token = data["refresh_token"]
        self.user_id = data["user_id"]
        kek = subkey(master_key, "pv1:kek")
        self.sk = open_(
            kek,
            unb64(data["protected_key_nonce"]),
            unb64(data["protected_symmetric_key"]),
            b"pv1:psk",
        )

    # ----------------------------------------------------------------- auth
    def register(self, email: str, password: str) -> dict:
        salt = os.urandom(16)
        mk = derive_master_key(password, salt, DEFAULT_KDF)
        sk = os.urandom(32)                       # la chiave del vault, casuale
        nonce, psk = seal(subkey(mk, "pv1:kek"), sk, b"pv1:psk")
        r = self.http.post(
            f"{self.base}/auth/register",
            json={
                "email": email,
                "auth_key": b64(subkey(mk, "pv1:auth")),
                "kdf_salt": b64(salt),
                **DEFAULT_KDF,
                "protected_symmetric_key": b64(psk),
                "protected_key_nonce": b64(nonce),
            },
        )
        r.raise_for_status()
        return r.json()

    def login(self, email: str, password: str) -> dict:
        pre = self.http.post(f"{self.base}/auth/prelogin", json={"email": email})
        pre.raise_for_status()
        params = pre.json()
        mk = derive_master_key(password, unb64(params["kdf_salt"]), params)

        r = self.http.post(
            f"{self.base}/auth/login",
            json={"email": email, "auth_key": b64(subkey(mk, "pv1:auth")), "device_label": "test"},
        )
        r.raise_for_status()
        data = r.json()
        self._store(data, mk)
        return data

    # ------------------------------------------------------- kit di emergenza
    def crea_kit_recupero(self) -> str:
        """Ritorna il codice da STAMPARE. Non viene mai inviato al server."""
        codice = genera_codice_recupero()
        salt = os.urandom(16)
        rk = derive_master_key(normalizza_codice(codice), salt, DEFAULT_KDF)
        nonce, blob = seal(subkey(rk, "pv1:rec:kek"), self.sk, b"pv1:recovery")

        r = self.http.post(
            f"{self.base}/auth/recovery/setup",
            headers=self.auth_headers,
            json={
                "recovery_auth_key": b64(subkey(rk, "pv1:rec:auth")),
                "recovery_salt": b64(salt),
                "recovery_kdf_memory_kib": DEFAULT_KDF["kdf_memory_kib"],
                "recovery_kdf_iterations": DEFAULT_KDF["kdf_iterations"],
                "recovery_kdf_parallelism": DEFAULT_KDF["kdf_parallelism"],
                "recovery_key_blob": b64(blob),
                "recovery_key_nonce": b64(nonce),
            },
        )
        r.raise_for_status()
        return codice

    def recupera(self, email: str, codice: str, nuova_password: str) -> dict:
        """Dal foglio di carta a una sessione valida, senza che il server veda
        mai il codice."""
        pre = self.http.post(f"{self.base}/auth/recovery/prelogin", json={"email": email})
        pre.raise_for_status()
        params = pre.json()
        rk = derive_master_key(
            normalizza_codice(codice),
            unb64(params["recovery_salt"]),
            {
                "kdf_iterations": params["recovery_kdf_iterations"],
                "kdf_memory_kib": params["recovery_kdf_memory_kib"],
                "kdf_parallelism": params["recovery_kdf_parallelism"],
            },
        )

        start = self.http.post(
            f"{self.base}/auth/recovery/start",
            json={"email": email, "recovery_auth_key": b64(subkey(rk, "pv1:rec:auth"))},
        )
        start.raise_for_status()
        d = start.json()

        # SK recuperata: il vault e' di nuovo leggibile.
        sk = open_(
            subkey(rk, "pv1:rec:kek"),
            unb64(d["recovery_key_nonce"]),
            unb64(d["recovery_key_blob"]),
            b"pv1:recovery",
        )

        # Nuova master password: si ri-wrappa la STESSA SK. Il vault non si tocca.
        nuovo_salt = os.urandom(16)
        nuova_mk = derive_master_key(nuova_password, nuovo_salt, DEFAULT_KDF)
        nonce, psk = seal(subkey(nuova_mk, "pv1:kek"), sk, b"pv1:psk")

        r = self.http.post(
            f"{self.base}/auth/recovery/complete",
            headers={"Authorization": f"Bearer {d['recovery_token']}"},
            json={
                "new_auth_key": b64(subkey(nuova_mk, "pv1:auth")),
                "new_kdf_salt": b64(nuovo_salt),
                "new_kdf_memory_kib": DEFAULT_KDF["kdf_memory_kib"],
                "new_kdf_iterations": DEFAULT_KDF["kdf_iterations"],
                "new_kdf_parallelism": DEFAULT_KDF["kdf_parallelism"],
                "new_protected_symmetric_key": b64(psk),
                "new_protected_key_nonce": b64(nonce),
            },
        )
        r.raise_for_status()
        self._store(r.json(), nuova_mk)
        return r.json()

    # ---------------------------------------------------------------- vault
    def create_item(self, item_type: str, payload: dict) -> dict:
        item_id = uuid.uuid4().hex               # id generato dal client: entra nell'AAD
        ck = os.urandom(32)
        nonce, ct = seal(ck, json.dumps(payload).encode(), item_aad(self.user_id, item_id, 1))
        wnonce, wk = seal(self.sk, ck, b"pv1:wrap")
        r = self.http.post(
            f"{self.base}/vault/items",
            headers=self.auth_headers,
            json={
                "id": item_id,
                "item_type": item_type,
                "nonce": b64(nonce),
                "ciphertext": b64(ct),
                "wrapped_key": b64(wk),
                "wrapped_key_nonce": b64(wnonce),
            },
        )
        r.raise_for_status()
        return r.json()

    def update_item(self, item: dict, payload: dict) -> dict:
        new_rev = item["revision"] + 1
        ck = os.urandom(32)
        nonce, ct = seal(
            ck, json.dumps(payload).encode(), item_aad(self.user_id, item["id"], new_rev)
        )
        wnonce, wk = seal(self.sk, ck, b"pv1:wrap")
        r = self.http.put(
            f"{self.base}/vault/items/{item['id']}",
            headers=self.auth_headers,
            json={
                "id": item["id"],
                "item_type": item["item_type"],
                "base_revision": item["revision"],
                "nonce": b64(nonce),
                "ciphertext": b64(ct),
                "wrapped_key": b64(wk),
                "wrapped_key_nonce": b64(wnonce),
            },
        )
        return r

    def decrypt_item(self, item: dict) -> dict:
        ck = open_(self.sk, unb64(item["wrapped_key_nonce"]), unb64(item["wrapped_key"]), b"pv1:wrap")
        raw = open_(
            ck,
            unb64(item["nonce"]),
            unb64(item["ciphertext"]),
            item_aad(self.user_id, item["id"], item["revision"]),
        )
        return json.loads(raw)

    # ---------------------------------------------------------------- files
    def upload(self, content: bytes, filename: str, mime: str, item_id: str | None = None) -> dict:
        import hashlib

        file_id = uuid.uuid4().hex
        fk = os.urandom(32)
        nonce, blob = seal(fk, content, file_aad(self.user_id, file_id))
        wnonce, wk = seal(self.sk, fk, b"pv1:wrap")
        # Anche il nome del file e' un segreto: viaggia cifrato.
        mnonce, meta = seal(
            self.sk,
            json.dumps({"name": filename, "mime": mime, "size": len(content)}).encode(),
            meta_aad(self.user_id, file_id),
        )

        init = self.http.post(
            f"{self.base}/files/init",
            headers=self.auth_headers,
            json={
                "id": file_id,
                "item_id": item_id,
                "size_bytes": len(blob),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "nonce": b64(nonce),
                "wrapped_file_key": b64(wk),
                "wrapped_key_nonce": b64(wnonce),
                "metadata_ct": b64(meta),
                "metadata_nonce": b64(mnonce),
            },
        )
        init.raise_for_status()

        put = self.http.put(
            f"{self.base}/files/{file_id}/content",
            headers={**self.auth_headers, "Content-Type": "application/octet-stream"},
            content=blob,
        )
        put.raise_for_status()
        return put.json()

    def download(self, meta: dict) -> tuple[bytes, dict]:
        r = self.http.get(f"{self.base}/files/{meta['id']}/content", headers=self.auth_headers)
        r.raise_for_status()
        fk = open_(self.sk, unb64(meta["wrapped_key_nonce"]), unb64(meta["wrapped_file_key"]), b"pv1:wrap")
        content = open_(fk, unb64(meta["nonce"]), r.content, file_aad(self.user_id, meta["id"]))
        info = json.loads(
            open_(
                self.sk,
                unb64(meta["metadata_nonce"]),
                unb64(meta["metadata_ct"]),
                meta_aad(self.user_id, meta["id"]),
            )
        )
        return content, info
