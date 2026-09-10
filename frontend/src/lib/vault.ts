/**
 * Lo strato che unisce crypto e API. E' la traduzione di `tests/client.py`,
 * che nel backend fa da specifica eseguibile ed e' coperto da 24 test.
 *
 *   master_password
 *         |
 *         v  Argon2id(kdf_salt del server)
 *      MK (32B)  --- non lascia mai il dispositivo
 *         |
 *         +--> HKDF(MK, "pv1:auth") --> auth_key --> al server
 *         +--> HKDF(MK, "pv1:kek")  --> KEK --unwrap--> SK (chiave del vault)
 *
 * SK e' separata da MK perche' cosi' cambiare la master password e' una sola
 * UPDATE: si ri-wrappa SK, non si ricifra il vault.
 */

import { ApiError, api, type FileOut, type ItemOut, type Tokens } from "./api";
import { leggiSnapshot, salvaSnapshot, type Snapshot } from "./offline";
import {
  type Bytes,
  AAD_PSK,
  AAD_RECOVERY,
  AAD_WRAP,
  DEFAULT_KDF,
  base64UrlToBuffer,
  bufferToBase64Url,
  deriveMasterKey,
  fileAad,
  generateRecoveryCode,
  itemAad,
  metaAad,
  normalizeRecoveryCode,
  open,
  openJson,
  randomBytes,
  seal,
  sealJson,
  subkey,
  utf8,
} from "./crypto";

export interface Session {
  userId: string;
  isAdmin: boolean;
  /** Chiave del vault. Solo in RAM, mai in localStorage. */
  sk: Bytes;
  /** Sessione aperta dalla cache locale, senza server: sola lettura. */
  offline: boolean;
}

/** Una password sostituita, con la data del cambio. */
export interface VoceStorico {
  password: string;
  cambiata: string;
}

/** Quante password precedenti si conservano. Cinque e' anche la scelta di
 *  Bitwarden: abbastanza per il caso d'uso reale — un sito che chiede la
 *  vecchia password per cambiarla, o un cambio che non e' andato a buon fine —
 *  senza trasformare la voce in un archivio di segreti scaduti. */
const STORICO_MAX = 5;

export interface ItemPayload {
  name: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  /** Secret base32 del 2FA. E' dentro il payload, quindi viaggia cifrato
   *  esattamente come la password: il server non lo distingue dal resto. */
  totp?: string;
  /** Password precedenti. Sta nel payload, quindi e' cifrato come il resto:
   *  il server non sa nemmeno che esiste uno storico. */
  storico?: VoceStorico[];
  /** Preferito. Sta nel payload e non in una colonna: cosi' il server non
   *  impara nemmeno quali voci usi di piu'. */
  preferito?: boolean;

  // --- campi delle carte, cifrati come tutto il resto ---
  intestatario?: string;
  numero?: string;
  scadenza?: string;
  cvv?: string;
  pin?: string;
}

export interface DecryptedItem {
  id: string;
  itemType: string;
  revision: number;
  updatedAt: string;
  payload: ItemPayload;
}

export interface FileMeta {
  name: string;
  mime: string;
  size: number;
}

export interface DecryptedFile {
  id: string;
  itemId: string | null;
  sizeBytes: number;
  meta: FileMeta;
}

const newId = () => window.crypto.randomUUID().replace(/-/g, "");

/** Un'etichetta riconoscibile nell'elenco dei dispositivi: "web" su tre righe
 *  non aiuta a capire quale sia il telefono e quale il portatile. */
function etichettaDispositivo(): string {
  const ua = navigator.userAgent;
  const sistema =
    /Android/i.test(ua) ? "Android"
    : /iPhone|iPad/i.test(ua) ? "iOS"
    : /Macintosh/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /Linux/i.test(ua) ? "Linux"
    : "sconosciuto";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "browser";
  return `${browser} su ${sistema}`.slice(0, 64);
}

/** SK sbloccata dalla KEK. Da qui in poi il vault e' leggibile. */
async function unwrapSk(masterKey: Bytes, tokens: Tokens): Promise<Bytes> {
  const kek = await subkey(masterKey, "pv1:kek");
  return open(
    kek,
    base64UrlToBuffer(tokens.protected_key_nonce),
    base64UrlToBuffer(tokens.protected_symmetric_key),
    AAD_PSK
  );
}

// ------------------------------------------------------------------- auth

export async function register(email: string, password: string) {
  const salt = randomBytes(16);
  const mk = await deriveMasterKey(password, salt, DEFAULT_KDF);
  const sk = randomBytes(32); // la chiave del vault, casuale
  const kek = await subkey(mk, "pv1:kek");
  const wrapped = await seal(kek, sk, AAD_PSK);

  return api.register({
    email,
    auth_key: bufferToBase64Url(await subkey(mk, "pv1:auth")),
    kdf_salt: bufferToBase64Url(salt),
    ...DEFAULT_KDF,
    protected_symmetric_key: bufferToBase64Url(wrapped.ciphertext),
    protected_key_nonce: bufferToBase64Url(wrapped.nonce),
  });
}

/** Il server risponde 428 quando la password e' giusta ma manca il codice:
 *  serve un errore distinguibile, o la schermata non saprebbe se mostrare il
 *  campo del codice o dire "credenziali errate". */
export class ServeCodice extends Error {
  constructor() {
    super("Serve il codice del secondo fattore.");
    this.name = "ServeCodice";
  }
}

export async function login(
  email: string,
  password: string,
  totpCode?: string
): Promise<Session> {
  // Il salt lo decide il server, non l'email: e' casuale e per-utente.
  const params = await api.prelogin(email);
  const mk = await deriveMasterKey(password, base64UrlToBuffer(params.kdf_salt), params);
  let tokens: Tokens;
  try {
    tokens = await api.login(
      email,
      bufferToBase64Url(await subkey(mk, "pv1:auth")),
      etichettaDispositivo(),
      totpCode
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 428) throw new ServeCodice();
    throw err;
  }
  api.setTokens(tokens);
  const sk = await unwrapSk(mk, tokens);

  // Si aggiornano i parametri necessari a rientrare senza server. Il vault
  // vero e proprio lo salva syncVault, che e' dove passano i dati.
  //
  // Se sul dispositivo c'e' lo snapshot di un ALTRO utente lo si butta: non e'
  // solo questione di igiene. Ereditandolo si terrebbero le voci cifrate del
  // familiare precedente sul telefono, e soprattutto si erediterebbe il suo
  // cursore `seq` — il nuovo utente chiederebbe un `since=` troppo alto e
  // vedrebbe un vault incompleto senza accorgersene.
  const precedente = await leggiSnapshot();
  const base =
    precedente && precedente.email.toLowerCase() === email.toLowerCase()
      ? precedente
      : { items: [], files: [], seq: 0 };

  await salvaSnapshot({
    ...base,
    email,
    userId: tokens.user_id,
    isAdmin: tokens.is_admin,
    kdf: {
      kdf_salt: params.kdf_salt,
      kdf_memory_kib: params.kdf_memory_kib,
      kdf_iterations: params.kdf_iterations,
      kdf_parallelism: params.kdf_parallelism,
    },
    protected_symmetric_key: tokens.protected_symmetric_key,
    protected_key_nonce: tokens.protected_key_nonce,
    salvato: new Date().toISOString(),
  } as Snapshot);

  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk, offline: false };
}

/**
 * Apertura senza server, dallo snapshot in IndexedDB.
 *
 * La verifica dell'identita' qui non la fa il server: la fa la crittografia.
 * Se la master password e' sbagliata, la KEK derivata non apre la SK wrappata
 * e AES-GCM fallisce la verifica del tag. Non c'e' modo di entrare con una
 * password errata, ne' di sapere se l'account esiste ancora sul server.
 */
export async function loginOffline(email: string, password: string): Promise<Session> {
  const snap = await leggiSnapshot();
  if (!snap || snap.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error("Nessuna copia locale per questo account su questo dispositivo.");
  }

  const mk = await deriveMasterKey(password, base64UrlToBuffer(snap.kdf.kdf_salt), snap.kdf);
  let sk: Bytes;
  try {
    sk = await open(
      await subkey(mk, "pv1:kek"),
      base64UrlToBuffer(snap.protected_key_nonce),
      base64UrlToBuffer(snap.protected_symmetric_key),
      AAD_PSK
    );
  } catch {
    throw new Error("Master Password errata.");
  }

  return { userId: snap.userId, isAdmin: snap.isAdmin, sk, offline: true };
}

/** Il vault dalla copia locale, decifrato in RAM. */
export async function caricaOffline(session: Session): Promise<VaultState> {
  const snap = await leggiSnapshot();
  if (!snap || snap.userId !== session.userId) return VAULT_VUOTO;

  const items: DecryptedItem[] = [];
  const unreadable: string[] = [];
  for (const raw of snap.items) {
    try {
      items.push(await decryptItem(session, raw));
    } catch {
      unreadable.push(raw.id);
    }
  }
  return {
    seq: snap.seq,
    items: items.sort((a, b) => a.payload.name.localeCompare(b.payload.name, "it")),
    files: snap.files,
    unreadable,
  };
}

export async function dataUltimoSnapshot(): Promise<string | null> {
  return (await leggiSnapshot())?.salvato ?? null;
}

export async function changeMasterPassword(
  session: Session,
  currentPassword: string,
  newPassword: string,
  email: string
): Promise<Session> {
  const current = await api.prelogin(email);
  const currentMk = await deriveMasterKey(
    currentPassword,
    base64UrlToBuffer(current.kdf_salt),
    current
  );

  const newSalt = randomBytes(16);
  const newMk = await deriveMasterKey(newPassword, newSalt, DEFAULT_KDF);
  // Si ri-wrappa la STESSA SK: il vault non viene toccato.
  const wrapped = await seal(await subkey(newMk, "pv1:kek"), session.sk, AAD_PSK);

  const tokens = await api.changeMasterPassword({
    current_auth_key: bufferToBase64Url(await subkey(currentMk, "pv1:auth")),
    new_auth_key: bufferToBase64Url(await subkey(newMk, "pv1:auth")),
    new_kdf_salt: bufferToBase64Url(newSalt),
    new_kdf_memory_kib: DEFAULT_KDF.kdf_memory_kib,
    new_kdf_iterations: DEFAULT_KDF.kdf_iterations,
    new_kdf_parallelism: DEFAULT_KDF.kdf_parallelism,
    new_protected_symmetric_key: bufferToBase64Url(wrapped.ciphertext),
    new_protected_key_nonce: bufferToBase64Url(wrapped.nonce),
  });
  api.setTokens(tokens);
  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk: session.sk, offline: false };
}

// -------------------------------------------------------- kit di emergenza

/** Crea o ruota il kit. Ritorna il codice da STAMPARE: non viene mai inviato. */
export async function createRecoveryKit(session: Session): Promise<string> {
  const code = generateRecoveryCode();
  const salt = randomBytes(16);
  const rk = await deriveMasterKey(normalizeRecoveryCode(code), salt, DEFAULT_KDF);
  const wrapped = await seal(await subkey(rk, "pv1:rec:kek"), session.sk, AAD_RECOVERY);

  await api.recoverySetup({
    recovery_auth_key: bufferToBase64Url(await subkey(rk, "pv1:rec:auth")),
    recovery_salt: bufferToBase64Url(salt),
    recovery_kdf_memory_kib: DEFAULT_KDF.kdf_memory_kib,
    recovery_kdf_iterations: DEFAULT_KDF.kdf_iterations,
    recovery_kdf_parallelism: DEFAULT_KDF.kdf_parallelism,
    recovery_key_blob: bufferToBase64Url(wrapped.ciphertext),
    recovery_key_nonce: bufferToBase64Url(wrapped.nonce),
  });
  return code;
}

/** Dal foglio di carta a una sessione valida, senza che il server veda il codice. */
export async function recover(
  email: string,
  code: string,
  newPassword: string
): Promise<Session> {
  const params = await api.recoveryPrelogin(email);
  const rk = await deriveMasterKey(
    normalizeRecoveryCode(code),
    base64UrlToBuffer(params.recovery_salt),
    {
      kdf_memory_kib: params.recovery_kdf_memory_kib,
      kdf_iterations: params.recovery_kdf_iterations,
      kdf_parallelism: params.recovery_kdf_parallelism,
    }
  );

  const started = await api.recoveryStart(
    email,
    bufferToBase64Url(await subkey(rk, "pv1:rec:auth"))
  );

  // SK recuperata: il vault e' di nuovo leggibile.
  const sk = await open(
    await subkey(rk, "pv1:rec:kek"),
    base64UrlToBuffer(started.recovery_key_nonce),
    base64UrlToBuffer(started.recovery_key_blob),
    AAD_RECOVERY
  );

  const newSalt = randomBytes(16);
  const newMk = await deriveMasterKey(newPassword, newSalt, DEFAULT_KDF);
  const wrapped = await seal(await subkey(newMk, "pv1:kek"), sk, AAD_PSK);

  const tokens = await api.recoveryComplete(started.recovery_token, {
    new_auth_key: bufferToBase64Url(await subkey(newMk, "pv1:auth")),
    new_kdf_salt: bufferToBase64Url(newSalt),
    new_kdf_memory_kib: DEFAULT_KDF.kdf_memory_kib,
    new_kdf_iterations: DEFAULT_KDF.kdf_iterations,
    new_kdf_parallelism: DEFAULT_KDF.kdf_parallelism,
    new_protected_symmetric_key: bufferToBase64Url(wrapped.ciphertext),
    new_protected_key_nonce: bufferToBase64Url(wrapped.nonce),
  });
  api.setTokens(tokens);
  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk, offline: false };
}

// ------------------------------------------------------------------ items

export async function decryptItem(session: Session, item: ItemOut): Promise<DecryptedItem> {
  const ck = await open(
    session.sk,
    base64UrlToBuffer(item.wrapped_key_nonce),
    base64UrlToBuffer(item.wrapped_key),
    AAD_WRAP
  );
  const payload = await openJson<ItemPayload>(
    ck,
    { nonce: item.nonce, ciphertext: item.ciphertext },
    itemAad(session.userId, item.id, item.revision)
  );
  return {
    id: item.id,
    itemType: item.item_type,
    revision: item.revision,
    updatedAt: item.updated_at,
    payload,
  };
}

function aggiornaStorico(precedente: ItemPayload, nuovo: ItemPayload): VoceStorico[] {
  const vecchia = precedente.password ?? "";
  const nuova = nuovo.password ?? "";
  const storico = precedente.storico ?? [];
  if (!vecchia || vecchia === nuova) return storico;
  return [{ password: vecchia, cambiata: new Date().toISOString() }, ...storico].slice(
    0,
    STORICO_MAX
  );
}

/** Una chiave per item, wrappata con SK: permette di ri-cifrare un singolo
 *  item senza toccare gli altri. */
async function sealItem(session: Session, itemId: string, revision: number, payload: ItemPayload) {
  const ck = randomBytes(32);
  const body = await sealJson(ck, payload, itemAad(session.userId, itemId, revision));
  const wrapped = await seal(session.sk, ck, AAD_WRAP);
  return {
    nonce: body.nonce,
    ciphertext: body.ciphertext,
    wrapped_key: bufferToBase64Url(wrapped.ciphertext),
    wrapped_key_nonce: bufferToBase64Url(wrapped.nonce),
  };
}

export async function createItem(
  session: Session,
  itemType: string,
  payload: ItemPayload
): Promise<DecryptedItem> {
  // L'id lo genera il client: entra nell'AAD, quindi deve esistere prima
  // della cifratura.
  const id = newId();
  const sealed = await sealItem(session, id, 1, payload);
  const created = await api.createItem({ id, item_type: itemType, ...sealed });
  return decryptItem(session, created);
}

export async function updateItem(
  session: Session,
  item: DecryptedItem,
  payload: ItemPayload
): Promise<DecryptedItem> {
  const nextRevision = item.revision + 1;
  // Lo storico lo ricostruisce sempre questa funzione dal valore SALVATO, mai
  // il modulo che raccoglie le modifiche: se lo gestisse la maschera, bastarebbe
  // un campo lasciato per sbaglio in un modulo per riscrivere la cronologia.
  const completo = { ...payload, storico: aggiornaStorico(item.payload, payload) };
  const sealed = await sealItem(session, item.id, nextRevision, completo);
  const updated = await api.updateItem(item.id, {
    id: item.id,
    item_type: item.itemType,
    base_revision: item.revision,
    ...sealed,
  });
  return decryptItem(session, updated);
}

export const deleteItem = (id: string) => api.deleteItem(id);
export const restoreItem = (id: string) => api.restoreItem(id);

export interface VoceCestinata extends DecryptedItem {
  deletedAt: string;
  attachments: number;
}

/** Il cestino arriva cifrato come tutto il resto: il nome si legge solo qui. */
export async function caricaCestino(session: Session): Promise<VoceCestinata[]> {
  const righe = await api.trash();
  const out: VoceCestinata[] = [];
  for (const raw of righe) {
    try {
      const voce = await decryptItem(session, raw);
      out.push({ ...voce, deletedAt: raw.deleted_at, attachments: raw.attachments });
    } catch {
      // Una voce illeggibile non deve nascondere le altre nel cestino.
    }
  }
  return out;
}

// ------------------------------------------------------------------ files

export async function decryptFileMeta(session: Session, f: FileOut): Promise<DecryptedFile> {
  const meta = await openJson<FileMeta>(
    session.sk,
    { nonce: f.metadata_nonce, ciphertext: f.metadata_ct },
    metaAad(session.userId, f.id)
  );
  return { id: f.id, itemId: f.item_id, sizeBytes: f.size_bytes, meta };
}

async function sha256Hex(data: Bytes): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadFile(
  session: Session,
  file: File,
  itemId: string | null
): Promise<DecryptedFile> {
  const id = newId();
  const content = new Uint8Array(await file.arrayBuffer());

  const fk = randomBytes(32);
  const body = await seal(fk, content, fileAad(session.userId, id));
  const wrapped = await seal(session.sk, fk, AAD_WRAP);
  // Anche il nome del file e' un segreto: viaggia cifrato.
  const meta = await sealJson(
    session.sk,
    { name: file.name, mime: file.type || "application/octet-stream", size: content.length },
    metaAad(session.userId, id)
  );

  await api.fileInit({
    id,
    item_id: itemId,
    size_bytes: body.ciphertext.length,
    sha256: await sha256Hex(body.ciphertext),
    nonce: bufferToBase64Url(body.nonce),
    wrapped_file_key: bufferToBase64Url(wrapped.ciphertext),
    wrapped_key_nonce: bufferToBase64Url(wrapped.nonce),
    metadata_ct: meta.ciphertext,
    metadata_nonce: meta.nonce,
  });

  const stored = await api.fileUpload(id, body.ciphertext);
  return decryptFileMeta(session, stored);
}

export async function downloadFile(session: Session, f: FileOut): Promise<{ blob: Blob; meta: FileMeta }> {
  const encrypted = await api.fileDownload(f.id);
  const fk = await open(
    session.sk,
    base64UrlToBuffer(f.wrapped_key_nonce),
    base64UrlToBuffer(f.wrapped_file_key),
    AAD_WRAP
  );
  const content = await open(
    fk,
    base64UrlToBuffer(f.nonce),
    encrypted,
    fileAad(session.userId, f.id)
  );
  const meta = await openJson<FileMeta>(
    session.sk,
    { nonce: f.metadata_nonce, ciphertext: f.metadata_ct },
    metaAad(session.userId, f.id)
  );
  return { blob: new Blob([content as BlobPart], { type: meta.mime }), meta };
}

// ------------------------------------------------------------------- sync

export interface VaultState {
  /** Cursore: la prossima sincronizzazione chiede solo cio' che e' cambiato dopo. */
  seq: number;
  items: DecryptedItem[];
  files: FileOut[];
  unreadable: string[];
}

export const VAULT_VUOTO: VaultState = { seq: 0, items: [], files: [], unreadable: [] };

/**
 * Sincronizzazione incrementale. Passando lo stato precedente si scarica e si
 * decifra solo il delta: senza cursore ogni refresh riscaricava e ridecifrava
 * l'intero vault, e le modifiche fatte da un altro dispositivo non arrivavano
 * mai perche' nessuno richiedeva l'aggiornamento.
 *
 * Passare `null` forza una sincronizzazione completa (primo caricamento).
 */
export async function syncVault(
  session: Session,
  precedente: VaultState | null = null
): Promise<VaultState> {
  const base = precedente ?? VAULT_VUOTO;
  const delta = await api.sync(base.seq);

  const items = new Map(base.items.map((i) => [i.id, i]));
  const files = new Map(base.files.map((f) => [f.id, f]));
  const unreadable = new Set(base.unreadable);

  // Un solo item illeggibile (ciphertext corrotto, AAD non combaciante) non
  // deve far fallire tutto il caricamento: in un password manager perdere
  // l'accesso a ogni voce per colpa di una riga e' il caso peggiore.
  for (const raw of delta.items) {
    try {
      items.set(raw.id, await decryptItem(session, raw));
      unreadable.delete(raw.id);
    } catch {
      items.delete(raw.id);
      unreadable.add(raw.id);
    }
  }
  for (const f of delta.files) files.set(f.id, f);

  // I tombstone propagano le cancellazioni fatte sugli altri dispositivi.
  for (const t of delta.tombstones) {
    items.delete(t.id);
    unreadable.delete(t.id);
  }
  for (const t of delta.file_tombstones) files.delete(t.id);

  const stato: VaultState = {
    seq: delta.seq,
    items: [...items.values()].sort((a, b) => a.payload.name.localeCompare(b.payload.name, "it")),
    files: [...files.values()],
    unreadable: [...unreadable],
  };

  // Si conserva il CIPHERTEXT com'e' arrivato, non gli item decifrati: la
  // cache non deve contenere nulla che il server non abbia gia'.
  const precedenteSnap = await leggiSnapshot();
  if (precedenteSnap && precedenteSnap.userId === session.userId) {
    const grezzi = new Map(precedenteSnap.items.map((i) => [i.id, i]));
    for (const raw of delta.items) grezzi.set(raw.id, raw);
    for (const t of delta.tombstones) grezzi.delete(t.id);
    await salvaSnapshot({
      ...precedenteSnap,
      items: [...grezzi.values()],
      files: stato.files,
      seq: stato.seq,
      salvato: new Date().toISOString(),
    });
  }

  return stato;
}

export { utf8 };
