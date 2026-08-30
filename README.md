# Family Vault — backend

Password & secrets manager zero-knowledge, self-hosted. Il server conserva
ciphertext opaco e non possiede alcuna chiave per leggerlo.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Il primo utente registrato diventa admin ed e' subito attivo. Gli altri restano
`pending` finche' l'admin non li approva. Dopo l'onboarding, `VAULT_ALLOW_REGISTRATION=false`.

---

## 1. Cosa il server sa, e cosa non puo' sapere

| Vede | Non vede |
|---|---|
| email, parametri KDF, salt | master password, chiavi di vault |
| dimensione dei blob, numero di item | nomi, URL, username, password, note |
| timestamp di creazione e modifica | nomi e contenuti dei file |
| `item_type` (login/nota/carta/file) | qualsiasi payload |

`item_type` in chiaro e' una scelta consapevole: consente filtri e conteggi
senza decifrare. Se il leak di metadati non e' accettabile, spostalo dentro il
ciphertext e paga con un sync sempre completo.

## 2. Struttura delle chiavi

```
master_password
      |
      v  Argon2id(salt=kdf_salt, m=64MiB, t=3, p=4)      [SOLO CLIENT]
   MK (32B) --- non lascia mai il dispositivo
      |
      +--> HKDF-SHA256(MK, "pv1:auth") --> auth_key --> al server
      |                                                 (che salva Argon2id(auth_key))
      |
      +--> HKDF-SHA256(MK, "pv1:kek") --> KEK
                                           |
                    SK (32B random)  <-----+ AES-256-GCM unwrap
                    chiave del vault         protected_symmetric_key
```

**SK separata da MK.** Cambiare la master password rimpiazza solo il wrapping di
SK: una singola UPDATE atomica. Senza questo livello, un cambio password su 2 GB
di allegati sarebbe un'operazione lunga e non atomica, cioe' corruzione garantita
al primo timeout.

**`auth_key` derivata, non MK.** Mandare MK permetterebbe al server di scartare
SK. HKDF con `info` diversi garantisce che `auth_key` non riveli nulla su KEK.

**Argon2id anche lato server.** `auth_key` ha l'entropia della master password,
non 256 bit: se il DB venisse rubato, un confronto diretto permetterebbe il
replay immediato. Parametri OWASP (m=19 MiB, t=2, p=1).

## 3. Flussi

### Registrazione
```
kdf_salt = random(16); MK = Argon2id(pwd, kdf_salt)
SK = random(32); psk = AES-GCM(HKDF(MK,"pv1:kek"), SK)
POST /auth/register { email, auth_key, kdf_salt, params, psk }
```
Il server ri-hasha `auth_key` e scarta il valore ricevuto: mai loggato, mai in
un messaggio d'errore.

### Login
```
POST /auth/prelogin { email }  ->  kdf_salt + parametri
MK = Argon2id(pwd, kdf_salt); auth_key = HKDF(MK, "pv1:auth")
POST /auth/login { email, auth_key }
   -> access JWT (15 min) + refresh (30 gg, rotante) + psk
SK = AES-GCM-open(HKDF(MK,"pv1:kek"), psk)   # solo in RAM, mai in localStorage
```

`prelogin` per email inesistenti risponde con parametri **deterministici e
finti** (`HMAC(server_secret, email)`): indistinguibile da un utente reale,
niente user enumeration. Il login verifica un hash dummy quando l'utente non
esiste, per equalizzare i tempi.

Il JWT porta `sst` (security stamp), rivalidato a ogni richiesta: bloccare un
utente o cambiargli password invalida all'istante tutti i token in circolazione.
I refresh token ruotano e hanno reuse detection: un token gia' usato che ritorna
significa furto, e fa cadere l'intera famiglia di token.

### Salvataggio di un item
```
CK    = random(32)
nonce = random(12)
ct    = AES-256-GCM(CK, nonce, JSON(payload), aad="pv1|<user_id>|<item_id>|<revision>")
wk    = AES-256-GCM(SK, nonce2, CK)
```

**L'AAD e' la parte che si dimentica.** Senza, un server compromesso puo'
spostare il ciphertext dell'item A nella riga dell'item B: il client decifra
senza errori e mostra la password sbagliata sul dominio sbagliato. Legando
`user_id`, `item_id` e `revision` all'autenticazione GCM, quello scambio
fallisce la verifica — ed e' incluso anche il rollback a una revisione
precedente. Verificato da `test_aad_blocca_lo_scambio_di_ciphertext`.

Gli **id sono generati dal client**: servono dentro l'AAD prima della
cifratura, e abilitano la creazione offline.

### Sync
Cursore `seq` monotono per utente (distinto da `revision`, che e' per-item):

```
GET /vault/sync?since=<seq>   -> items + files + tombstones + nuovo seq
PUT /vault/items/{id}         -> 409 se base_revision != revision corrente
```

Il server non puo' fare merge: non sa cosa unirebbe. I conflitti li risolve il
client, l'unico che puo' leggere entrambe le versioni.

## 4. Formato di trasporto

I `bytes` viaggiano in **base64 URL-SAFE** (alfabeto `-_`, con padding): e' cio'
che Pydantic emette. In ingresso il server accetta anche l'alfabeto standard, in
uscita no. Un frontend che decodifica con `atob()` grezzo fallira' su circa un
blob su due. Riferimento: `tests/client.py`.

Argon2id nel browser richiede WASM (`hash-wasm` o `argon2-browser`): WebCrypto
non lo implementa. HKDF, AES-GCM e SHA-256 sono invece nativi in WebCrypto.

## 5. Storage dei file

**Ibrido con soglia**: metadati sempre in SQLite, blob sul filesystem sopra i
64 KB, inline nel DB sotto.

- **Performance.** Sotto ~100 KB SQLite batte il filesystem (due syscall in
  meno). Sopra, SQLAlchemy materializza il BLOB interamente in RAM, due volte:
  un allegato da 50 MB diventa 100+ MB di picco per richiesta. Dal filesystem
  `FileResponse` fa streaming a RAM costante.
- **Backup.** Un SQLite da 5 GB si ricopia *tutto* a ogni snapshot. Con i blob
  su filesystem e immutabili, `restic`/`rsync` fanno incrementale reale e il DB
  resta di pochi MB.
- **Content-addressing** (nome = SHA-256 del ciphertext): integrita'
  verificabile senza conoscere il plaintext, immutabilita', scrittura atomica
  (`tmp` -> `fsync` -> `rename` -> `fsync` della dir). **Non** deduplica: in
  zero-knowledge due file identici hanno ciphertext diversi, quindi la dedup e'
  strutturalmente nulla.
- **Directory per utente**: l'isolamento si verifica con un `ls`, e non serve
  refcounting fra utenti.

Upload in due fasi — `POST /files/init` prenota la quota (contando anche le
prenotazioni aperte, o due upload paralleli sfondano il limite), poi
`PUT /files/{id}/content` fa streaming del corpo grezzo verificando hash e
dimensione *mentre passano*. Una fase sola significherebbe riempire il disco per
poi fare rollback.

**Cifratura at-rest del DB:** non serve SQLCipher. I blob sono gia' ciphertext,
il DB contiene solo hash Argon2 e chiavi wrappate. Usa la full-disk encryption
del ThinkPad (LUKS / FileVault).

## 6. Backup — l'ordine conta

```bash
./scripts/backup.sh /mnt/backup
```

**Prima il DB, poi i blob.** Lo snapshot del DB a T1 referenzia solo blob
scritti prima di T1, tutti catturati dalla scansione a T2 > T1. L'ordine inverso
produce riferimenti pendenti. Regge su due invarianti: blob immutabili e
cancellazioni differite.

Per questo `DELETE /files/{id}` non fa mai `unlink()`: marca un tombstone, e il
GC libera il disco dopo `gc_grace_days`.

```cron
30 3 * * *  cd /srv/vault && .venv/bin/python scripts/gc.py
0  4 * * *  cd /srv/vault && ./scripts/backup.sh /mnt/backup
```

## 7. Ruolo admin

L'admin vede statistiche di sistema, approva, blocca e assegna quote. Nessun
endpoint in `app/api/admin.py` legge `ciphertext`, `protected_symmetric_key`,
`wrapped_key` o `inline_data`.

Non e' una policy applicata a runtime: e' l'assenza fisica delle chiavi. La KEK
di ogni utente esiste solo sul suo dispositivo. Verificato da
`test_admin_non_vede_i_dati_altrui`.

## 8. Kit di emergenza

In una famiglia la perdita della master password non e' un rischio: e' una
certezza. Il recupero e' una **seconda strada verso la stessa SK**, indipendente
dalla prima e altrettanto cieca per il server.

```
codice di recupero (su carta, 160 bit)
      |
      v  Argon2id(recovery_salt)
   RK (32B)
      |
      +--> HKDF(RK, "pv1:rec:auth") --> recovery_auth_key --> al server
      |                                 (che ne salva l'hash Argon2id)
      |
      +--> HKDF(RK, "pv1:rec:kek") --unwrap--> recovery_key_blob --> SK
```

| | |
|---|---|
| `POST /auth/recovery/setup` | crea o **ruota** il kit (sessione attiva) |
| `GET /auth/recovery/status` | se e' configurato, e da quando |
| `DELETE /auth/recovery` | rimuove il kit |
| `POST /auth/recovery/prelogin` | `recovery_salt` + parametri KDF |
| `POST /auth/recovery/start` | prova il codice, restituisce blob + token di recupero |
| `POST /auth/recovery/complete` | nuova master password, ritorna una sessione |

Quattro dettagli che fanno la differenza:

- **Il blob non e' scaricabile da chi conosce l'email.** `recovery/start`
  pretende prima `recovery_auth_key`. Il codice ha entropia da chiave, quindi il
  brute force offline sarebbe comunque impraticabile — ma non c'e' motivo di
  regalare il materiale su cui tentarlo. Cinque tentativi falliti, poi un'ora di
  blocco, su contatori **separati** da quelli del login: martellare il recupero
  non deve poter bloccare l'accesso normale della vittima.
- **Scope del token.** Il token emesso da `recovery/start` ha `scp="recovery"`,
  vive 10 minuti e non apre il vault: `GET /vault/sync` con quel token risponde
  401. Simmetricamente, una sessione normale non puo' chiamare
  `recovery/complete` saltando la prova del codice.
- **SK non cambia durante il recupero**, quindi il foglio nel cassetto resta
  valido anche dopo. E' il comportamento giusto per una famiglia, non una
  svista: chi ha appena recuperato l'accesso non deve anche ristampare tutto
  seduta stante. Per invalidarlo si chiama `recovery/setup`, che sovrascrive.
- **Il formato del codice e' affare del client.** Il server vede solo una
  sottochiave derivata e un blob opaco. `tests/client.py` genera 160 bit in
  base32 a gruppi di 4; sostituirlo con 24 parole BIP39 non tocca una riga di
  backend.

## 9. Deploy — HTTPS non e' opzionale

VPN privata, mai esposto al web. **E comunque TLS**, per due motivi di peso
diverso:

1. **Il frontend non funziona senza.** Fuori da un secure context i browser non
   espongono `window.crypto.subtle`: e' `undefined`. Dal telefono verso l'IP del
   ThinkPad in `http://` non c'e' derivazione di chiavi ne' decifratura —
   l'applicazione non parte. L'unica eccezione e' `localhost`.
2. Senza TLS `auth_key` viaggia in chiaro sulla LAN. Chi la intercetta non
   decifra nulla, ma puo' autenticarsi.

**Con Tailscale** (consigliato): i certificati sono firmati da una CA pubblica,
quindi nessun profilo da installare sui telefoni e nessun avviso da accettare.

```bash
./scripts/serve-tls.sh
```

Rileva il nome della macchina sul tailnet, chiama `tailscale cert` la prima
volta e avvia uvicorn in HTTPS sulla 8443. Senza reverse proxy.

**Senza Tailscale**: il `Caddyfile` incluso usa `tls internal`. Costo: la CA di
Caddy va installata su ogni dispositivo — e su iOS serve installare il profilo
*e* abilitare la fiducia piena in Impostazioni > Info > Certificati. Per lo
sviluppo locale, `mkcert` fa lo stesso con meno cerimonie.

Ricordati di allineare `VAULT_CORS_ORIGINS` all'origine **https** del frontend.

```bash
chmod 700 data/            # data/jwt.key e vault.db sono gia' 0600
```

## 10. Frontend

Client React in `frontend/`, zero-knowledge: vedi `frontend/README.md`.

```bash
cd frontend && npm install && npm run dev
```

Il protocollo e' definito da `tests/client.py`, che il frontend traduce in
TypeScript in `src/lib/vault.ts`. Quando i due divergono, la ragione ce l'ha
Python: e' quello coperto dai test.

## 11. Test

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q
```

24 test. I piu' importanti non verificano che le feature funzionino, ma che il
server **non possa leggere**: `test_il_server_non_puo_leggere` cerca il
plaintext dentro SQLite, `test_blob_su_disco_e_cifrato` lo cerca dentro i file
su disco, `test_il_codice_di_recupero_non_raggiunge_il_server` cerca il codice
di carta dentro la riga utente, `test_isolamento_dei_vault` e
`test_admin_non_vede_i_dati_altrui` verificano l'isolamento.

## 12. Schema del database

Non c'e' Alembic: `create_all()` crea le tabelle mancanti all'avvio, ma **non
aggiunge colonne** a tabelle gia' esistenti. Finche' `data/` e' vuoto non e' un
problema; dal primo dato reale in poi, una modifica ai modelli va accompagnata
da un `ALTER TABLE` o da un dump e reimport.
