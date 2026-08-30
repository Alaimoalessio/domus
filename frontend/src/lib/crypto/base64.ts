/**
 * Da TypeScript 5.7 Uint8Array e' generico sul buffer sottostante, e le firme
 * di WebCrypto accettano solo ArrayBuffer (non SharedArrayBuffer). Fissarlo
 * una volta qui evita un cast a ogni chiamata.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Base64 URL-SAFE (alfabeto -_).
 *
 * Pydantic serializza i bytes con questo alfabeto: un `atob()` grezzo sui blob
 * del backend fallisce non appena compare un '-' o un '_'. In ingresso il
 * server accetta anche l'alfabeto standard, in uscita no.
 */

export function bufferToBase64Url(buffer: Bytes): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64UrlToBuffer(value: string): Bytes {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Bytes {
  return window.crypto.getRandomValues(new Uint8Array(length));
}

export const utf8 = new TextEncoder();
export const fromUtf8 = new TextDecoder();
