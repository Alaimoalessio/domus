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

import { api, type FileOut, type ItemOut, type Tokens } from "./api";
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
}

export interface ItemPayload {
  name: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  /** Secret base32 del 2FA. E' dentro il payload, quindi viaggia cifrato
   *  esattamente come la password: il server non lo distingue dal resto. */
  totp?: string;
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

export async function login(email: string, password: string): Promise<Session> {
  // Il salt lo decide il server, non l'email: e' casuale e per-utente.
  const params = await api.prelogin(email);
  const mk = await deriveMasterKey(password, base64UrlToBuffer(params.kdf_salt), params);
  const tokens = await api.login(email, bufferToBase64Url(await subkey(mk, "pv1:auth")), "web");
  api.setTokens(tokens);

  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk: await unwrapSk(mk, tokens) };
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
  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk: session.sk };
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
  return { userId: tokens.user_id, isAdmin: tokens.is_admin, sk };
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
  const sealed = await sealItem(session, item.id, nextRevision, payload);
  const updated = await api.updateItem(item.id, {
    id: item.id,
    item_type: item.itemType,
    base_revision: item.revision,
    ...sealed,
  });
  return decryptItem(session, updated);
}

export const deleteItem = (id: string) => api.deleteItem(id);

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

export async function loadVault(session: Session) {
  const state = await api.sync(0);
  const items = await Promise.all(state.items.map((i) => decryptItem(session, i)));
  return { seq: state.seq, items, files: state.files };
}

export { utf8 };
