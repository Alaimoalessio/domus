import { type Bytes, base64UrlToBuffer, bufferToBase64Url, randomBytes, utf8 } from "./base64";

/** AES-256-GCM via WebCrypto. Richiede un secure context: fuori da https (o
 *  localhost) `window.crypto.subtle` e' undefined e nulla di qui funziona. */

export interface Sealed {
  ciphertext: string; // base64url
  nonce: string; // base64url
}

async function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(
  key: Bytes,
  plaintext: Bytes,
  aad: Bytes
): Promise<{ nonce: Bytes; ciphertext: Bytes }> {
  const nonce = randomBytes(12);
  const buf = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    await importAesKey(key),
    plaintext
  );
  return { nonce, ciphertext: new Uint8Array(buf) as Bytes };
}

export async function open(
  key: Bytes,
  nonce: Bytes,
  ciphertext: Bytes,
  aad: Bytes
): Promise<Bytes> {
  const buf = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    await importAesKey(key),
    ciphertext
  );
  return new Uint8Array(buf) as Bytes;
}

/** Comodita': cifra/decifra oggetti JSON restituendo stringhe base64url. */
export async function sealJson(key: Bytes, value: unknown, aad: Bytes): Promise<Sealed> {
  const { nonce, ciphertext } = await seal(key, utf8.encode(JSON.stringify(value)), aad);
  return { nonce: bufferToBase64Url(nonce), ciphertext: bufferToBase64Url(ciphertext) };
}

export async function openJson<T>(key: Bytes, sealed: Sealed, aad: Bytes): Promise<T> {
  const raw = await open(
    key,
    base64UrlToBuffer(sealed.nonce),
    base64UrlToBuffer(sealed.ciphertext),
    aad
  );
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}

// --------------------------------------------------------------------- AAD
//
// L'AAD lega il ciphertext alla riga che lo contiene. Senza, un server
// compromesso puo' spostare il ciphertext dell'item A dentro la riga dell'item
// B: il client decifra senza errori e mostra la password sbagliata sul dominio
// sbagliato. Includendo la revision si chiude anche il rollback.
// Devono combaciare carattere per carattere con il backend.

export const itemAad = (userId: string, itemId: string, revision: number): Bytes =>
  utf8.encode(`pv1|${userId}|${itemId}|${revision}`);

export const fileAad = (userId: string, fileId: string): Bytes =>
  utf8.encode(`pv1f|${userId}|${fileId}`);

export const metaAad = (userId: string, fileId: string): Bytes =>
  utf8.encode(`pv1fm|${userId}|${fileId}`);

/** Contesti fissi, senza id: la chiave del vault e' una sola per utente. */
export const AAD_PSK = utf8.encode("pv1:psk");
export const AAD_WRAP = utf8.encode("pv1:wrap");
export const AAD_RECOVERY = utf8.encode("pv1:recovery");
