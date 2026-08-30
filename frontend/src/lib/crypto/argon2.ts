import { argon2id } from "hash-wasm";

import { type Bytes, bufferToBase64Url, utf8 } from "./base64";

/**
 * Argon2id + HKDF-SHA256, lato client. WebCrypto non implementa Argon2:
 * serve WASM (hash-wasm). HKDF invece e' nativo.
 */

export interface KdfParams {
  kdf_memory_kib: number;
  kdf_iterations: number;
  kdf_parallelism: number;
}

export const DEFAULT_KDF: KdfParams = {
  kdf_memory_kib: 65536, // 64 MiB
  kdf_iterations: 3,
  kdf_parallelism: 4,
};

/**
 * Deriva la master key. Il salt arriva SEMPRE dal server (/auth/prelogin):
 * e' casuale e per-utente, e cambia a ogni cambio password o recupero.
 * Derivarlo dall'email lo renderebbe prevedibile e romperebbe entrambi i flussi.
 */
export async function deriveMasterKey(
  password: string,
  salt: Bytes,
  params: KdfParams
): Promise<Bytes> {
  return (await argon2id({
    password,
    salt,
    parallelism: params.kdf_parallelism,
    iterations: params.kdf_iterations,
    memorySize: params.kdf_memory_kib,
    hashLength: 32,
    outputType: "binary",
  })) as Bytes;
}

/**
 * Separazione di dominio: auth_key non rivela nulla sulla KEK e viceversa.
 * salt vuoto = salt di zeri, come `HKDF(salt=None)` in Python (HMAC riempie di
 * zeri fino alla dimensione del blocco in entrambi i casi).
 */
export async function subkey(masterKey: Bytes, info: string): Promise<Bytes> {
  const base = await window.crypto.subtle.importKey("raw", masterKey, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await window.crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(info) },
    base,
    256
  );
  return new Uint8Array(bits) as Bytes;
}

/** La sottochiave che viaggia verso il server, in chiaro solo rispetto a lui. */
export async function authKeyFrom(masterKey: Bytes): Promise<string> {
  return bufferToBase64Url(await subkey(masterKey, "pv1:auth"));
}
