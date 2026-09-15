import { del, get, set } from "idb-keyval";

import { api, ApiError, type Tokens } from "./api";
import {
  AAD_PSK,
  base64UrlToBuffer,
  bufferToBase64Url,
  deriveMasterKey,
  open,
  randomBytes,
  seal,
  subkey,
  type Bytes,
} from "./crypto";
import { eAppNativa } from "./server";
import { etichettaDispositivo, loginOffline, type Session } from "./vault";

/**
 * Sblocco rapido: riaprire il vault senza master password.
 *
 * Tre meccanismi, un solo formato di pacchetto: {SK, refresh token} cifrati
 * con AES-GCM sotto una "wrap key" (WK) che dipende dal meccanismo.
 *
 *   PIN       WK = HKDF(pin_key || device_secret)
 *             pin_key    = Argon2id(PIN, salt)              — sul dispositivo
 *             device_secret                                 — SOLO sul server,
 *             consegnato a chi presenta HKDF(pin_key,"verify"), 5 tentativi.
 *             Un ladro con il telefono non puo' provare PIN offline; senza
 *             server il PIN non apre nulla (per questo esiste la master
 *             password, che funziona anche offline).
 *
 *   Impronta  WK = chiave casuale custodita dal Keystore Android con
 *   (nativa)  BIOMETRY_CURRENT_SET: ogni lettura richiede il sensore, e una
 *             nuova impronta registrata invalida la chiave.
 *
 *   WebAuthn  vedi biometric.ts (PRF), per il browser.
 *
 * In tutti i casi la master password non viene mai memorizzata.
 *
 * Il refresh token nel pacchetto e' PARCHEGGIATO: una famiglia a parte,
 * emessa apposta, che la sessione viva non tocca. Metterci il token della
 * sessione viva sarebbe un errore silenzioso: quella ruota il proprio ogni
 * 15 minuti, e allo sblocco il server vedrebbe un token gia' ruotato — la
 * reuse detection abbatterebbe l'intera famiglia. Allo sblocco il token
 * parcheggiato viene speso e ne viene sigillato subito uno nuovo.
 */

const CHIAVE_PIN = "domus:pin:v1";
const CHIAVE_NATIVO = "domus:nativo:v1";
const VOCE_KEYSTORE = "domus.wk";

/** Argon2 piu' leggero di quello della master password: il PIN non e' la
 *  difesa, lo e' il device_secret; qui serve solo a non rendere gratis un
 *  attacco a chi avesse gia' rubato ANCHE il database del server. */
const KDF_PIN = { kdf_memory_kib: 32768, kdf_iterations: 3, kdf_parallelism: 2 };

interface Pacchetto {
  sk: string;
  refreshToken: string;
}

interface RecordBase {
  email: string;
  userId: string;
  isAdmin: boolean;
  pacchetto: string;
  nonce: string;
  creato: string;
}

export interface RecordPin extends RecordBase {
  deviceId: string;
  salt: string;
}

export type RecordNativo = RecordBase;

export interface EsitoSblocco {
  session: Session;
  online: boolean;
}

async function sigilla(wk: Bytes, sk: Bytes, refreshToken: string) {
  const contenuto = new TextEncoder().encode(
    JSON.stringify({ sk: bufferToBase64Url(sk), refreshToken } satisfies Pacchetto)
  ) as Bytes;
  const { nonce, ciphertext } = await seal(wk, contenuto, AAD_PSK);
  return { pacchetto: bufferToBase64Url(ciphertext), nonce: bufferToBase64Url(nonce) };
}

async function apri(wk: Bytes, record: RecordBase): Promise<Pacchetto> {
  try {
    const raw = await open(
      wk,
      base64UrlToBuffer(record.nonce),
      base64UrlToBuffer(record.pacchetto),
      AAD_PSK
    );
    return JSON.parse(new TextDecoder().decode(raw));
  } catch (err) {
    throw new Error("Il pacchetto di sblocco non e' apribile su questo dispositivo.", { cause: err });
  }
}

/**
 * Dal pacchetto aperto alla sessione. Il refresh token vale una volta: se il
 * server risponde, il nuovo va risalvato con la WK ancora in memoria — o il
 * prossimo sblocco fallirebbe e la reuse detection abbatterebbe la famiglia.
 */
async function completa<R extends RecordBase>(
  record: R,
  wk: Bytes,
  contenuto: Pacchetto,
  salva: (r: R) => Promise<void>,
  cancella: () => Promise<void>
): Promise<EsitoSblocco> {
  const sk = base64UrlToBuffer(contenuto.sk);
  const base: Session = { userId: record.userId, isAdmin: record.isAdmin, sk, offline: false };
  try {
    const tokens: Tokens = await api.rinnovaSessione(contenuto.refreshToken);
    const parcheggiato = await api.unlockToken(`sblocco rapido · ${etichettaDispositivo()}`);
    await salva({ ...record, ...(await sigilla(wk, sk, parcheggiato)) });
    return { session: { ...base, isAdmin: tokens.is_admin }, online: true };
  } catch (err) {
    // Sessione revocata (401/403): il pacchetto e' morto, va tolto. Un
    // guasto di rete invece lascia tutto com'e' e apre la copia locale.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      await cancella();
      throw new Error("La sessione salvata non e' piu' valida: entra con la master password.", {
        cause: err,
      });
    }
    return { session: { ...base, offline: true }, online: false };
  }
}

// ------------------------------------------------------------------- PIN

async function chiaviPin(pin: string, salt: Bytes) {
  const pinKey = await deriveMasterKey(pin, salt, KDF_PIN);
  return {
    verifier: bufferToBase64Url(await subkey(pinKey, "pv1:pin:verify")),
    wk: async (deviceSecretHex: string) => {
      const segreto = new Uint8Array(deviceSecretHex.match(/../g)!.map((h) => parseInt(h, 16)));
      const unione = new Uint8Array(pinKey.length + segreto.length);
      unione.set(pinKey);
      unione.set(segreto, pinKey.length);
      return subkey(unione as Bytes, "pv1:pin:wrap");
    },
  };
}

export function pinValido(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return "Il PIN deve avere da 4 a 8 cifre.";
  if (/^(\d)\1+$/.test(pin)) return "Un PIN di cifre tutte uguali non protegge nulla.";
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return "Niente sequenze.";
  return null;
}

export async function abilitaPin(session: Session, email: string, pin: string): Promise<void> {
  const errore = pinValido(pin);
  if (errore) throw new Error(errore);
  if (!api.haSessione()) throw new Error("Serve una sessione attiva.");

  await disabilitaPin(); // un solo dispositivo per pacchetto
  const salt = randomBytes(16);
  const { verifier, wk } = await chiaviPin(pin, salt);
  const { device_id, device_secret } = await api.unlockEnroll(verifier, etichettaDispositivo());
  const parcheggiato = await api.unlockToken(`sblocco rapido · ${etichettaDispositivo()}`);
  const chiave = await wk(device_secret);
  await set(CHIAVE_PIN, {
    deviceId: device_id,
    salt: bufferToBase64Url(salt),
    email,
    userId: session.userId,
    isAdmin: session.isAdmin,
    ...(await sigilla(chiave, session.sk, parcheggiato)),
    creato: new Date().toISOString(),
  } satisfies RecordPin);
}

export async function sbloccaConPin(pin: string): Promise<EsitoSblocco> {
  const record = await leggiRecordPin();
  if (!record) throw new Error("Nessun PIN su questo dispositivo.");
  const { verifier, wk } = await chiaviPin(pin, base64UrlToBuffer(record.salt));
  let segreto: string;
  try {
    segreto = await api.unlock(record.deviceId, verifier);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      await del(CHIAVE_PIN).catch(() => {});
      throw new Error("Lo sblocco con PIN e' stato disattivato: entra con la master password.", { cause: err });
    }
    if (err instanceof ApiError) throw err;
    throw new Error("Il PIN ha bisogno del server: senza rete usa la master password.", { cause: err });
  }
  const chiave = await wk(segreto);
  const contenuto = await apri(chiave, record);
  return completa(
    record,
    chiave,
    contenuto,
    (r) => set(CHIAVE_PIN, r),
    () => del(CHIAVE_PIN).catch(() => {})
  );
}

export async function leggiRecordPin(): Promise<RecordPin | null> {
  try {
    return (await get<RecordPin>(CHIAVE_PIN)) ?? null;
  } catch {
    return null;
  }
}

export async function disabilitaPin(): Promise<void> {
  const record = await leggiRecordPin();
  if (record) await api.unlockForget(record.deviceId).catch(() => {});
  await del(CHIAVE_PIN).catch(() => {});
}

// ---------------------------------------------------------- impronta nativa

async function plugin() {
  const m = await import("@capgo/capacitor-native-biometric");
  return { NativeBiometric: m.NativeBiometric, AccessControl: m.AccessControl };
}

export async function improntaNativaDisponibile(): Promise<{ disponibile: boolean; motivo?: string }> {
  if (!eAppNativa()) return { disponibile: false, motivo: "Solo nell'app installata." };
  try {
    const { NativeBiometric } = await plugin();
    const r = await NativeBiometric.isAvailable({ useFallback: false });
    if (!r.isAvailable) return { disponibile: false, motivo: "Nessuna impronta o volto registrati." };
    if (!r.strongBiometryIsAvailable) {
      return { disponibile: false, motivo: "Il sensore di questo dispositivo non e' di classe forte." };
    }
    return { disponibile: true };
  } catch {
    return { disponibile: false, motivo: "Biometria non disponibile." };
  }
}

export async function abilitaImprontaNativa(session: Session, email: string): Promise<void> {
  if (!api.haSessione()) throw new Error("Serve una sessione attiva.");
  const { NativeBiometric, AccessControl } = await plugin();
  const parcheggiato = await api.unlockToken(`sblocco rapido · ${etichettaDispositivo()}`);
  const wk = randomBytes(32);
  // La WK entra nel Keystore protetta dal sensore: da qui in poi ogni lettura
  // chiede l'impronta, e il pacchetto in IndexedDB senza WK e' inerte.
  await NativeBiometric.setData({
    key: VOCE_KEYSTORE,
    value: bufferToBase64Url(wk),
    accessControl: AccessControl.BIOMETRY_CURRENT_SET,
    title: "Domus",
  });
  await set(CHIAVE_NATIVO, {
    email,
    userId: session.userId,
    isAdmin: session.isAdmin,
    ...(await sigilla(wk, session.sk, parcheggiato)),
    creato: new Date().toISOString(),
  } satisfies RecordNativo);
}

export async function sbloccaConImprontaNativa(): Promise<EsitoSblocco> {
  const record = await leggiRecordNativo();
  if (!record) throw new Error("Impronta non configurata su questo dispositivo.");
  const { NativeBiometric } = await plugin();
  let valore: string;
  try {
    valore = (
      await NativeBiometric.getSecureData({
        key: VOCE_KEYSTORE,
        title: "Sblocca Domus",
        reason: "Apri il vault",
        negativeButtonText: "Annulla",
      })
    ).value;
  } catch (err) {
    throw new Error("Sblocco annullato o chiave non piu' valida (impronte cambiate?).", { cause: err });
  }
  const wk = base64UrlToBuffer(valore);
  const contenuto = await apri(wk, record);
  return completa(record, wk, contenuto, (r) => set(CHIAVE_NATIVO, r), disabilitaImprontaNativa);
}

export async function leggiRecordNativo(): Promise<RecordNativo | null> {
  if (!eAppNativa()) return null;
  try {
    return (await get<RecordNativo>(CHIAVE_NATIVO)) ?? null;
  } catch {
    return null;
  }
}

export async function disabilitaImprontaNativa(): Promise<void> {
  await del(CHIAVE_NATIVO).catch(() => {});
  try {
    const { NativeBiometric } = await plugin();
    await NativeBiometric.deleteData({ key: VOCE_KEYSTORE });
  } catch {
    /* niente da rimuovere */
  }
}

// ---------------------------------------------------------- master password

/**
 * Riapertura con la master password senza passare dal server: lo snapshot
 * locale ha gia' salt, parametri e SK wrappata. Se la sessione e' ancora
 * viva si rientra online, altrimenti in sola lettura.
 */
export async function sbloccaConMasterPassword(email: string, password: string): Promise<Session> {
  const s = await loginOffline(email, password);
  return { ...s, offline: !api.haSessione() };
}
