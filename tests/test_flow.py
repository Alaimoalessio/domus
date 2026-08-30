"""Test end-to-end. Verificano soprattutto UNA cosa: che il server non possa
leggere nulla. Il resto e' contorno."""
import json
import os
import tempfile
import uuid

import pytest

from tests.client import b64, normalizza_codice, unb64


@pytest.fixture(scope="module")
def app_ctx():
    tmp = tempfile.mkdtemp(prefix="vault-test-")
    os.environ["VAULT_DATA_DIR"] = tmp
    os.environ["VAULT_JWT_SECRET"] = "test-secret-not-for-production"
    os.environ["VAULT_ALLOW_REGISTRATION"] = "true"
    os.environ["VAULT_MAX_USERS"] = "50"   # in produzione resta 4

    import app.core.config as cfg
    cfg.get_settings.cache_clear()
    for mod in list(__import__("sys").modules):
        if mod.startswith("app."):
            del __import__("sys").modules[mod]

    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.base import SessionLocal

    with TestClient(app) as client:
        yield client, SessionLocal


@pytest.fixture(scope="module")
def clients(app_ctx):
    from tests.client import VaultClient

    http, _ = app_ctx
    alice = VaultClient(http)
    alice.register("alice@family.local", "master-password-di-alice-2026")
    alice.login("alice@family.local", "master-password-di-alice-2026")

    bob = VaultClient(http)
    reg = bob.register("bob@family.local", "master-password-di-bob-2026")
    assert reg["status"] == "pending", "il secondo utente deve attendere approvazione"

    # Alice e' admin (primo utente): approva Bob.
    http.post(f"/api/v1/admin/users/{reg['id']}/approve", headers=alice.auth_headers)
    bob.login("bob@family.local", "master-password-di-bob-2026")
    return alice, bob


def nuovo_utente(http, admin, email: str, password: str):
    """Utente dedicato, per i test che ruotano lo security stamp: farlo su bob
    invaliderebbe il suo token e romperebbe i test successivi."""
    from tests.client import VaultClient

    c = VaultClient(http)
    reg = c.register(email, password)
    http.post(f"/api/v1/admin/users/{reg['id']}/approve", headers=admin.auth_headers)
    c.login(email, password)
    return c


def test_primo_utente_e_admin(clients):
    alice, bob = clients
    assert alice.login("alice@family.local", "master-password-di-alice-2026")["is_admin"] is True
    assert bob.login("bob@family.local", "master-password-di-bob-2026")["is_admin"] is False


def test_prelogin_non_rivela_utenti_inesistenti(app_ctx):
    http, _ = app_ctx
    a = http.post("/api/v1/auth/prelogin", json={"email": "nessuno@family.local"})
    b = http.post("/api/v1/auth/prelogin", json={"email": "nessuno@family.local"})
    reale = http.post("/api/v1/auth/prelogin", json={"email": "alice@family.local"})
    assert a.status_code == b.status_code == reale.status_code == 200
    assert a.json() == b.json(), "deterministico: stessa email, stessa risposta"
    assert set(a.json()) == set(reale.json()), "forma identica a quella di un utente vero"


def test_roundtrip_item(clients):
    alice, _ = clients
    segreto = {"username": "alice", "password": "hunter2", "url": "https://banca.example"}
    created = alice.create_item("login", segreto)
    assert alice.decrypt_item(created) == segreto


def test_il_server_non_puo_leggere(clients, app_ctx):
    """Il test che conta: si guarda direttamente dentro SQLite."""
    alice, _ = clients
    _, SessionLocal = app_ctx
    from sqlalchemy import select
    from app.db.models import VaultItem

    alice.create_item("login", {"password": "PAROLA-IN-CHIARO-DA-NON-TROVARE"})
    db = SessionLocal()
    try:
        blob = b"".join(
            i.ciphertext for i in db.scalars(select(VaultItem)) if i.ciphertext
        )
    finally:
        db.close()
    assert b"PAROLA-IN-CHIARO-DA-NON-TROVARE" not in blob
    assert b"password" not in blob, "nemmeno i nomi dei campi trapelano"


def test_aad_blocca_lo_scambio_di_ciphertext(clients, app_ctx):
    """Simula un server ostile che sposta il ciphertext di un item su un altro."""
    from cryptography.exceptions import InvalidTag

    alice, _ = clients
    a = alice.create_item("login", {"password": "conto-corrente"})
    b = alice.create_item("login", {"password": "email"})

    manomesso = dict(b)
    manomesso["ciphertext"] = a["ciphertext"]
    manomesso["nonce"] = a["nonce"]
    manomesso["wrapped_key"] = a["wrapped_key"]
    manomesso["wrapped_key_nonce"] = a["wrapped_key_nonce"]

    with pytest.raises(InvalidTag):
        alice.decrypt_item(manomesso)


def test_conflitto_di_revisione(clients):
    alice, _ = clients
    item = alice.create_item("login", {"password": "v1"})
    assert alice.update_item(item, {"password": "v2"}).status_code == 200
    # Secondo update con la stessa base: il client e' indietro.
    assert alice.update_item(item, {"password": "v3"}).status_code == 409


def test_isolamento_dei_vault(clients, app_ctx):
    http, _ = app_ctx
    alice, bob = clients
    item = alice.create_item("login", {"password": "solo-di-alice"})

    r = http.get(f"/api/v1/vault/items/{item['id']}", headers=bob.auth_headers)
    assert r.status_code == 404, "Bob non deve nemmeno sapere che l'item esiste"

    sync = http.get("/api/v1/vault/sync?since=0", headers=bob.auth_headers).json()
    assert all(i["id"] != item["id"] for i in sync["items"])


def test_admin_non_vede_i_dati_altrui(clients, app_ctx):
    http, _ = app_ctx
    alice, bob = clients
    item = bob.create_item("login", {"password": "solo-di-bob"})

    # Alice e' admin, ma l'API di amministrazione non espone ciphertext ne' chiavi.
    users = http.get("/api/v1/admin/users", headers=alice.auth_headers).json()
    serializzato = json.dumps(users)
    for campo in ("protected_symmetric_key", "ciphertext", "wrapped_key", "kdf_salt"):
        assert campo not in serializzato

    # E l'endpoint utente resta scoped sul proprio vault.
    assert http.get(f"/api/v1/vault/items/{item['id']}", headers=alice.auth_headers).status_code == 404


def test_file_inline_e_su_filesystem(clients):
    alice, _ = clients

    piccolo = b"documento breve, resta dentro SQLite"
    meta = alice.upload(piccolo, "nota.txt", "text/plain")
    contenuto, info = alice.download(meta)
    assert contenuto == piccolo
    assert info["name"] == "nota.txt"

    grande = os.urandom(300 * 1024)   # oltre la soglia di 64 KB
    meta = alice.upload(grande, "passaporto.pdf", "application/pdf")
    contenuto, info = alice.download(meta)
    assert contenuto == grande
    assert info["name"] == "passaporto.pdf"


def test_blob_su_disco_e_cifrato(clients, app_ctx):
    alice, _ = clients
    from app.core.config import settings

    marcatore = b"CONTENUTO-SENSIBILE-DEL-DOCUMENTO" * 100
    alice.upload(marcatore, "referto.pdf", "application/pdf")

    for percorso in settings.blob_root.rglob("*"):
        if percorso.is_file():
            assert marcatore[:33] not in percorso.read_bytes()


def test_hash_sbagliato_rifiutato(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    file_id = uuid.uuid4().hex
    n = b64(os.urandom(12))
    init = http.post(
        "/api/v1/files/init",
        headers=alice.auth_headers,
        json={
            "id": file_id, "item_id": None, "size_bytes": 10,
            "sha256": "0" * 64,
            "nonce": n, "wrapped_file_key": n, "wrapped_key_nonce": n,
            "metadata_ct": n, "metadata_nonce": n,
        },
    )
    assert init.status_code == 201
    r = http.put(
        f"/api/v1/files/{file_id}/content", headers=alice.auth_headers, content=b"0123456789"
    )
    assert r.status_code == 422


def test_download_altrui_negato(clients, app_ctx):
    http, _ = app_ctx
    alice, bob = clients
    meta = alice.upload(b"privato di alice", "a.txt", "text/plain")
    r = http.get(f"/api/v1/files/{meta['id']}/content", headers=bob.auth_headers)
    assert r.status_code == 404


def test_rotazione_refresh_e_reuse_detection(clients, app_ctx):
    http, _ = app_ctx
    from tests.client import VaultClient

    c = VaultClient(http)
    c.login("bob@family.local", "master-password-di-bob-2026")
    vecchio = c.refresh_token

    r1 = http.post("/api/v1/auth/refresh", json={"refresh_token": vecchio})
    assert r1.status_code == 200
    nuovo = r1.json()["refresh_token"]

    # Il vecchio token ripresentato = furto: cade tutta la famiglia.
    assert http.post("/api/v1/auth/refresh", json={"refresh_token": vecchio}).status_code == 401
    assert http.post("/api/v1/auth/refresh", json={"refresh_token": nuovo}).status_code == 401


def test_cambio_master_password_non_ricifra_il_vault(clients, app_ctx):
    """Cambia solo il wrapping di SK: gli item restano leggibili invariati."""
    http, _ = app_ctx
    alice, _ = clients
    from tests.client import DEFAULT_KDF, VaultClient, derive_master_key, seal, subkey

    vecchia_pw, nuova_pw = "master-password-di-carol-2026", "una-master-password-nuova-2026"
    carol = nuovo_utente(http, alice, "carol@family.local", vecchia_pw)
    item = carol.create_item("login", {"password": "sopravvive-al-cambio"})
    sk_prima = carol.sk

    params = http.post("/api/v1/auth/prelogin", json={"email": "carol@family.local"}).json()
    vecchia_mk = derive_master_key(vecchia_pw, unb64(params["kdf_salt"]), params)
    nuovo_salt = os.urandom(16)
    nuova_mk = derive_master_key(nuova_pw, nuovo_salt, DEFAULT_KDF)
    nonce, psk = seal(subkey(nuova_mk, "pv1:kek"), carol.sk, b"pv1:psk")

    r = http.post(
        "/api/v1/auth/master-password",
        headers=carol.auth_headers,
        json={
            "current_auth_key": b64(subkey(vecchia_mk, "pv1:auth")),
            "new_auth_key": b64(subkey(nuova_mk, "pv1:auth")),
            "new_kdf_salt": b64(nuovo_salt),
            "new_kdf_memory_kib": DEFAULT_KDF["kdf_memory_kib"],
            "new_kdf_iterations": DEFAULT_KDF["kdf_iterations"],
            "new_kdf_parallelism": DEFAULT_KDF["kdf_parallelism"],
            "new_protected_symmetric_key": b64(psk),
            "new_protected_key_nonce": b64(nonce),
        },
    )
    assert r.status_code == 200

    # Il token vecchio deve morire: lo security stamp e' stato ruotato.
    assert http.get("/api/v1/auth/me", headers=carol.auth_headers).status_code == 401
    # E la risposta ne ha gia' consegnati di nuovi, senza un secondo login.
    freschi = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert http.get("/api/v1/auth/me", headers=freschi).status_code == 200

    dopo = VaultClient(http)
    dopo.login("carol@family.local", nuova_pw)
    assert dopo.sk == sk_prima, "SK invariata: nessuna ricifratura del vault"

    letto = http.get(f"/api/v1/vault/items/{item['id']}", headers=dopo.auth_headers).json()
    assert dopo.decrypt_item(letto) == {"password": "sopravvive-al-cambio"}


def test_quota(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    me = http.get("/api/v1/auth/me", headers=alice.auth_headers).json()
    http.post(
        f"/api/v1/admin/users/{me['id']}/quota",
        headers=alice.auth_headers,
        json={"storage_quota_bytes": 1024},
    )
    n = b64(os.urandom(12))
    r = http.post(
        "/api/v1/files/init",
        headers=alice.auth_headers,
        json={
            "id": uuid.uuid4().hex, "item_id": None, "size_bytes": 50_000,
            "sha256": "a" * 64, "nonce": n, "wrapped_file_key": n,
            "wrapped_key_nonce": n, "metadata_ct": n, "metadata_nonce": n,
        },
    )
    assert r.status_code == 507
    http.post(
        f"/api/v1/admin/users/{me['id']}/quota",
        headers=alice.auth_headers,
        json={"storage_quota_bytes": 2 * 1024**3},
    )


def test_bob_non_e_admin(clients, app_ctx):
    http, _ = app_ctx
    _, bob = clients
    assert http.get("/api/v1/admin/stats", headers=bob.auth_headers).status_code == 403


def test_sync_incrementale(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    stato = http.get("/api/v1/vault/sync?since=0", headers=alice.auth_headers).json()
    cursore = stato["seq"]

    nuovo = alice.create_item("nota", {"testo": "aggiunto dopo il cursore"})
    delta = http.get(f"/api/v1/vault/sync?since={cursore}", headers=alice.auth_headers).json()
    assert [i["id"] for i in delta["items"]] == [nuovo["id"]]

    http.delete(f"/api/v1/vault/items/{nuovo['id']}", headers=alice.auth_headers)
    delta = http.get(f"/api/v1/vault/sync?since={cursore}", headers=alice.auth_headers).json()
    assert delta["items"] == []
    assert [t["id"] for t in delta["tombstones"]] == [nuovo["id"]]


# =============================================================== kit di emergenza

def test_recupero_completo(clients, app_ctx):
    """Lo scenario che in famiglia succedera' davvero: password dimenticata,
    foglio nel cassetto."""
    http, _ = app_ctx
    alice, _ = clients
    from tests.client import VaultClient

    utente = nuovo_utente(http, alice, "dario@family.local", "password-dimenticabile")
    segreto = {"password": "deve-sopravvivere-alla-dimenticanza"}
    item = utente.create_item("login", segreto)
    sk_originale = utente.sk

    codice = utente.crea_kit_recupero()
    assert len(normalizza_codice(codice)) == 32, "160 bit di entropia"
    assert http.get("/api/v1/auth/me", headers=utente.auth_headers).json()["recovery_configured"]

    # Password dimenticata. Solo il foglio di carta.
    dario = VaultClient(http)
    dario.recupera("dario@family.local", codice, "una-password-che-ricordo-2026")

    assert dario.sk == sk_originale, "stessa SK: il vault non e' stato ricifrato"
    letto = http.get(f"/api/v1/vault/items/{item['id']}", headers=dario.auth_headers).json()
    assert dario.decrypt_item(letto) == segreto

    # E la nuova password funziona da sola.
    dopo = VaultClient(http)
    dopo.login("dario@family.local", "una-password-che-ricordo-2026")
    assert dopo.sk == sk_originale


def test_il_codice_di_recupero_non_raggiunge_il_server(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    _, SessionLocal = app_ctx
    from sqlalchemy import select
    from app.db.models import User

    utente = nuovo_utente(http, alice, "elena@family.local", "password-di-elena-2026")
    codice = utente.crea_kit_recupero()

    db = SessionLocal()
    try:
        u = db.scalar(select(User).where(User.email == "elena@family.local"))
        riga = f"{u.recovery_auth_hash}{u.recovery_salt}{u.recovery_key_blob}".encode()
    finally:
        db.close()

    assert normalizza_codice(codice).encode() not in riga
    assert codice.encode() not in riga
    # Nemmeno un frammento: 8 caratteri sarebbero gia' una riduzione di entropia.
    assert normalizza_codice(codice)[:8].encode() not in riga


def test_codice_sbagliato_rifiutato(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    from tests.client import VaultClient, genera_codice_recupero

    utente = nuovo_utente(http, alice, "fabio@family.local", "password-di-fabio-2026")
    utente.crea_kit_recupero()

    intruso = VaultClient(http)
    with pytest.raises(Exception):
        intruso.recupera("fabio@family.local", genera_codice_recupero(), "password-rubata")


def test_recovery_prelogin_non_rivela_chi_ha_il_kit(clients, app_ctx):
    """Un utente senza kit e uno inesistente devono essere indistinguibili."""
    http, _ = app_ctx
    senza_kit = http.post(
        "/api/v1/auth/recovery/prelogin", json={"email": "bob@family.local"}
    ).json()
    inesistente = http.post(
        "/api/v1/auth/recovery/prelogin", json={"email": "nessuno@family.local"}
    ).json()
    con_kit = http.post(
        "/api/v1/auth/recovery/prelogin", json={"email": "dario@family.local"}
    ).json()

    assert set(senza_kit) == set(inesistente) == set(con_kit)
    assert senza_kit["recovery_salt"] != inesistente["recovery_salt"], "salt per-email"
    ripetuto = http.post(
        "/api/v1/auth/recovery/prelogin", json={"email": "nessuno@family.local"}
    ).json()
    assert ripetuto == inesistente, "deterministico"


def test_token_di_recupero_non_apre_il_vault(clients, app_ctx):
    """Lo scope deve reggere: un token 'recovery' non e' una sessione."""
    http, _ = app_ctx
    alice, _ = clients
    from tests.client import derive_master_key, subkey

    utente = nuovo_utente(http, alice, "gaia@family.local", "password-di-gaia-2026")
    codice = utente.crea_kit_recupero()

    params = http.post(
        "/api/v1/auth/recovery/prelogin", json={"email": "gaia@family.local"}
    ).json()
    rk = derive_master_key(
        normalizza_codice(codice),
        unb64(params["recovery_salt"]),
        {
            "kdf_iterations": params["recovery_kdf_iterations"],
            "kdf_memory_kib": params["recovery_kdf_memory_kib"],
            "kdf_parallelism": params["recovery_kdf_parallelism"],
        },
    )
    d = http.post(
        "/api/v1/auth/recovery/start",
        json={"email": "gaia@family.local", "recovery_auth_key": b64(subkey(rk, "pv1:rec:auth"))},
    ).json()
    solo_recupero = {"Authorization": f"Bearer {d['recovery_token']}"}

    assert http.get("/api/v1/vault/sync?since=0", headers=solo_recupero).status_code == 401
    assert http.get("/api/v1/auth/me", headers=solo_recupero).status_code == 401
    assert http.get("/api/v1/files", headers=solo_recupero).status_code == 401


def test_access_token_non_completa_un_recupero(clients, app_ctx):
    """E il contrario: una sessione normale non puo' saltare la prova del codice."""
    http, _ = app_ctx
    alice, _ = clients
    n = b64(os.urandom(12))
    r = http.post(
        "/api/v1/auth/recovery/complete",
        headers=alice.auth_headers,
        json={
            "new_auth_key": b64(os.urandom(32)), "new_kdf_salt": n,
            "new_kdf_memory_kib": 65536, "new_kdf_iterations": 3, "new_kdf_parallelism": 4,
            "new_protected_symmetric_key": n, "new_protected_key_nonce": n,
        },
    )
    assert r.status_code == 401


def test_rotazione_del_kit_invalida_il_foglio_vecchio(clients, app_ctx):
    http, _ = app_ctx
    alice, _ = clients
    from tests.client import VaultClient

    utente = nuovo_utente(http, alice, "ivan@family.local", "password-di-ivan-2026")
    vecchio = utente.crea_kit_recupero()
    nuovo = utente.crea_kit_recupero()
    assert vecchio != nuovo

    with pytest.raises(Exception):
        VaultClient(http).recupera("ivan@family.local", vecchio, "x-password-2026")

    c = VaultClient(http)
    c.recupera("ivan@family.local", nuovo, "password-nuova-di-ivan-2026")
    assert c.sk == utente.sk
