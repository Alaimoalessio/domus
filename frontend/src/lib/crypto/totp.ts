import type { Bytes } from "./base64";

/**
 * TOTP (RFC 6238) su WebCrypto.
 *
 * Niente otplib: servirebbero polyfill di Buffer per girare nel browser, e
 * l'algoritmo e' una trentina di righe. Una dipendenza in meno in un'app dove
 * ogni dipendenza vede i segreti in chiaro.
 *
 * Il secret e' un campo come gli altri dentro il payload dell'item: viene
 * cifrato con la stessa chiave e la stessa AAD, il server non lo distingue
 * dalla password.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class InvalidSecret extends Error {}

/**
 * Accetta sia il secret base32 nudo sia l'URI otpauth:// completo: chi
 * configura il 2FA di solito ha sottomano il secondo.
 */
export function normalizeTotpSecret(input: string): string {
  let value = input.trim();
  if (value.toLowerCase().startsWith("otpauth://")) {
    const secret = new URL(value).searchParams.get("secret");
    if (!secret) throw new InvalidSecret("URI otpauth senza parametro secret");
    value = secret;
  }
  return value.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function base32Decode(secret: string): Bytes {
  const clean = normalizeTotpSecret(secret);
  if (clean.length === 0) throw new InvalidSecret("secret vuoto");

  let bits = "";
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new InvalidSecret(`carattere non valido: ${ch}`);
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  if (bytes.length === 0) throw new InvalidSecret("secret troppo corto");
  return bytes as Bytes;
}

export interface TotpCode {
  code: string;
  /** Secondi rimasti prima della rotazione: alimenta il timer circolare. */
  secondsLeft: number;
  period: number;
}

export async function generateTotp(
  secret: string,
  { period = 30, digits = 6, at = Date.now() }: { period?: number; digits?: number; at?: number } = {}
): Promise<TotpCode> {
  const key = await window.crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" }, // RFC 6238: SHA-1 e' l'algoritmo standard
    false,
    ["sign"]
  );

  const seconds = Math.floor(at / 1000);
  const counter = BigInt(Math.floor(seconds / period));
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, counter, false); // big endian

  const mac = new Uint8Array(await window.crypto.subtle.sign("HMAC", key, buf));

  // Troncamento dinamico (RFC 4226 §5.3)
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return {
    code: (binary % 10 ** digits).toString().padStart(digits, "0"),
    secondsLeft: period - (seconds % period),
    period,
  };
}
