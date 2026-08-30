import { randomBytes } from "./base64";

/**
 * Codice di recupero: 160 bit in base32, in gruppi di 4.
 *
 * Il server e' agnostico sul formato — vede solo una sottochiave derivata e un
 * blob opaco. Sostituire questo con 24 parole BIP39 non tocca il backend.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32 RFC 4648

export function generateRecoveryCode(): string {
  const bytes = randomBytes(20); // 160 bit
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");

  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out.match(/.{1,4}/g)!.join("-");
}

/** Chi lo ridigita dal foglio non deve indovinare trattini e maiuscole. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}
