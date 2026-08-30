import { bufferToBase64Url, base64UrlToBuffer } from './base64';

/**
 * Generates a random 12-byte nonce (IV) for AES-GCM.
 */
export function generateNonce(): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Imports a raw 32-byte master key into a CryptoKey for AES-GCM.
 */
export async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedData {
  ciphertext: string; // Base64 URL-safe
  nonce: string; // Base64 URL-safe
}

/**
 * Encrypts a string (e.g., secret payload) using AES-256-GCM.
 * The Item ID is used as AAD (Additional Authenticated Data).
 */
export async function encryptString(
  key: CryptoKey,
  plaintext: string,
  itemId: string
): Promise<EncryptedData> {
  const nonce = generateNonce();
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const aad = encoder.encode(itemId);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
    },
    key,
    data
  );

  return {
    ciphertext: bufferToBase64Url(new Uint8Array(encryptedBuffer)),
    nonce: bufferToBase64Url(nonce),
  };
}

/**
 * Decrypts an encrypted string payload.
 */
export async function decryptString(
  key: CryptoKey,
  encryptedData: EncryptedData,
  itemId: string
): Promise<string> {
  const nonce = base64UrlToBuffer(encryptedData.nonce);
  const ciphertext = base64UrlToBuffer(encryptedData.ciphertext);
  const aad = new TextEncoder().encode(itemId);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
    },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Encrypts a file (ArrayBuffer) up to 20MB.
 */
export async function encryptFile(
  key: CryptoKey,
  fileData: ArrayBuffer,
  itemId: string
): Promise<{ encryptedBlob: Blob; nonce: string }> {
  const nonce = generateNonce();
  const aad = new TextEncoder().encode(itemId);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
    },
    key,
    fileData
  );

  return {
    encryptedBlob: new Blob([encryptedBuffer], { type: 'application/octet-stream' }),
    nonce: bufferToBase64Url(nonce),
  };
}

/**
 * Decrypts a file into an object URL for download.
 */
export async function decryptFileToUrl(
  key: CryptoKey,
  encryptedBuffer: ArrayBuffer,
  nonceBase64Url: string,
  itemId: string,
  mimeType: string
): Promise<string> {
  const nonce = base64UrlToBuffer(nonceBase64Url);
  const aad = new TextEncoder().encode(itemId);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
    },
    key,
    encryptedBuffer
  );

  const blob = new Blob([decryptedBuffer], { type: mimeType });
  return URL.createObjectURL(blob);
}
