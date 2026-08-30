# Frontend — Family Vault

Client zero-knowledge. Tutta la crittografia avviene qui: il server riceve solo
ciphertext opaco e non possiede alcuna chiave per leggerlo.

```bash
npm install
npm run dev          # http://localhost:5199, proxy /api -> 127.0.0.1:8000
```

Il backend deve girare sulla 8000 (`uvicorn app.main:app --port 8000` dalla
radice del repo). In sviluppo il proxy di Vite tiene tutto su una sola origine,
quindi niente CORS.

## HTTPS non e' opzionale

Fuori da un secure context i browser non espongono `window.crypto.subtle`: e'
`undefined`. Da `localhost` funziona; dal telefono verso l'IP del ThinkPad in
`http://` **l'app non parte affatto** — niente derivazione di chiavi, niente
decifratura. In produzione si passa da `scripts/serve-tls.sh` (certificato
Tailscale) o dal `Caddyfile` nella radice del repo.

## Struttura

| | |
|---|---|
| `src/lib/crypto/` | Argon2id (hash-wasm), HKDF e AES-GCM (WebCrypto), base64url, codice di recupero |
| `src/lib/api.ts` | client HTTP tipizzato. Nessuna logica crittografica: vede solo ciphertext |
| `src/lib/vault.ts` | lo strato che unisce i due. E' la traduzione di `tests/client.py` |
| `src/context/AuthContext.tsx` | SK in RAM, auto-lock a 10 minuti |

`tests/client.py` nel backend e' la specifica eseguibile del protocollo, coperta
da 24 test: quando i due divergono, la ragione ce l'ha Python.

## Tre invarianti da non rompere

**Il salt arriva dal server.** `/auth/prelogin` restituisce un salt casuale e
per-utente, che cambia a ogni cambio password e a ogni recupero. Derivarlo
dall'email lo renderebbe prevedibile e romperebbe entrambi i flussi.

**La SK e' separata dalla master key.** La master key non cifra mai gli item
direttamente: sblocca la SK (`protected_symmetric_key`), che e' la vera chiave
del vault. Grazie a questo, cambiare la master password e' una singola UPDATE
invece di una ricifratura completa — ed e' anche cio' che rende possibile il kit
di emergenza, che wrappa la stessa SK sotto il codice stampato.

**L'AAD lega il ciphertext alla sua riga.** `pv1|user_id|item_id|revision` per
gli item, `pv1f|...` e `pv1fm|...` per file e metadati. Senza, un server
compromesso puo' spostare un ciphertext da un item all'altro e il client
mostrerebbe la password sbagliata sul dominio sbagliato, senza errori.

## Base64

I `bytes` viaggiano in base64 **URL-safe** (alfabeto `-_`): e' quello che
Pydantic emette. Un `atob()` grezzo fallisce su circa un blob su due. Usare
sempre `bufferToBase64Url` / `base64UrlToBuffer`.

## Tailwind

Configurazione CSS-first in `src/index.css`, senza `tailwind.config.js`: i
componenti shadcn presenti usano sintassi v4 (`ring-3`, `in-data-[...]`,
`color-mix(in oklch, ...)`, `var(--radius-md)`) che su v3 non esiste.
