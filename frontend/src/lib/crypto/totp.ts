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

export type AlgoritmoTotp = "SHA-1" | "SHA-256" | "SHA-512";

export interface ParametriTotp {
  secret: string;
  digits: number;
  period: number;
  algorithm: AlgoritmoTotp;
  /** Dal label/issuer dell'URI otpauth, quando c'e': utile per il nome della voce. */
  issuer?: string;
  account?: string;
}

const ALGORITMI: Record<string, AlgoritmoTotp> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

/**
 * Accetta sia il secret base32 nudo sia l'URI otpauth:// completo: chi
 * configura il 2FA di solito ha sottomano il secondo. Dall'URI si leggono
 * anche cifre, periodo e algoritmo: quasi tutti i siti usano 6/30/SHA1, ma
 * chi non lo fa produrrebbe codici sempre sbagliati senza alcun errore.
 */
export function parametriTotp(input: string): ParametriTotp {
  const value = input.trim();
  const base: ParametriTotp = { secret: "", digits: 6, period: 30, algorithm: "SHA-1" };
  if (!value.toLowerCase().startsWith("otpauth://")) {
    return { ...base, secret: value.toUpperCase().replace(/[^A-Z2-7]/g, "") };
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new InvalidSecret("URI otpauth non valido");
  }
  if (u.host.toLowerCase() !== "totp") throw new InvalidSecret("Solo i codici TOTP sono supportati");
  const secret = u.searchParams.get("secret");
  if (!secret) throw new InvalidSecret("URI otpauth senza parametro secret");
  const digits = Number(u.searchParams.get("digits") ?? 6);
  const period = Number(u.searchParams.get("period") ?? 30);
  const algo = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");
  if (![6, 7, 8].includes(digits)) throw new InvalidSecret("Numero di cifre non supportato");
  if (!Number.isInteger(period) || period < 10 || period > 300) throw new InvalidSecret("Periodo non valido");
  if (!ALGORITMI[algo]) throw new InvalidSecret(`Algoritmo non supportato: ${algo}`);
  // label = "Issuer:account" oppure solo "account"; l'issuer nel parametro vince
  const label = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  const [primaParte, ...resto] = label.split(":");
  const issuer = u.searchParams.get("issuer") ?? (resto.length ? primaParte : undefined);
  const account = (resto.length ? resto.join(":") : primaParte).trim() || undefined;
  return {
    secret: secret.toUpperCase().replace(/[^A-Z2-7]/g, ""),
    digits,
    period,
    algorithm: ALGORITMI[algo],
    issuer: issuer?.trim() || undefined,
    account,
  };
}

export function normalizeTotpSecret(input: string): string {
  return parametriTotp(input).secret;
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
  { at = Date.now() }: { at?: number } = {}
): Promise<TotpCode> {
  const p = parametriTotp(secret);
  const key = await window.crypto.subtle.importKey(
    "raw",
    base32Decode(p.secret),
    { name: "HMAC", hash: p.algorithm }, // RFC 6238: SHA-1 e' il default
    false,
    ["sign"]
  );

  const seconds = Math.floor(at / 1000);
  const counter = BigInt(Math.floor(seconds / p.period));
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
    code: (binary % 10 ** p.digits).toString().padStart(p.digits, "0"),
    secondsLeft: p.period - (seconds % p.period),
    period: p.period,
  };
}
