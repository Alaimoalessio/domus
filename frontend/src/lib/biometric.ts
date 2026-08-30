import { del, get, set } from "idb-keyval";

import { api, type Tokens } from "./api";
import {
  AAD_PSK,
  base64UrlToBuffer,
  bufferToBase64Url,
  open,
  randomBytes,
  seal,
  subkey,
  type Bytes,
} from "./crypto";
import type { Session } from "./vault";

/**
 * Sblocco biometrico locale con WebAuthn PRF.
 *
 * Il Secure Enclave NON e' raggiungibile da una pagina web: non esiste un'API
 * per cifrare dati arbitrari con l'enclave, quella e' una capacita' nativa.
 * L'estensione PRF di WebAuthn e' l'unico modo, sul web, di ottenere materiale
 * crittografico legato al gesto biometrico.
 *
 *   navigator.credentials.get({ extensions: { prf: { eval: { first: salt } } } })
 *         |  richiede FaceID / TouchID / impronta
 *         v
 *      output PRF (32B, rigenerato a ogni sblocco, MAI memorizzato)
 *         |  HKDF-SHA256, info "pv1:prf:wrap"
 *         v
 *        WK ---unwrap---> { SK, refresh token }  conservati cifrati in IndexedDB
 *
 * A riposo sul dispositivo resta solo il pacchetto cifrato: senza il gesto
 * biometrico e' inerte. La master password non viene mai memorizzata, ne' in
 * chiaro ne' cifrata: quello che si sblocca e' la SK, che e' esattamente cio'
 * che serve per leggere il vault e nulla di piu'.
 */

const CHIAVE = "domus:biometria:v1";

export interface RecordBiometrico {
  credentialId: string;
  /** Salt del PRF: pubblico per costruzione, e' un input dell'estensione. */
  prfSalt: string;
  email: string;
  userId: string;
  isAdmin: boolean;
  /** AES-GCM(WK, JSON({sk, refreshToken})) */
  pacchetto: string;
  nonce: string;
  creato: string;
}

export interface Supporto {
  disponibile: boolean;
  motivo?: string;
}

/**
 * Controllo stringente. `getClientCapabilities` e' la via diretta dove esiste;
 * altrove si puo' solo verificare che ci sia un autenticatore con verifica
 * dell'utente, e la certezza sul PRF arriva al momento della registrazione —
 * per questo `abilita` ricontrolla e si ferma se l'estensione non e' attiva.
 */
export async function verificaSupporto(): Promise<Supporto> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { disponibile: false, motivo: "Questo browser non supporta WebAuthn." };
  }
  if (!window.isSecureContext) {
    return { disponibile: false, motivo: "Serve una connessione HTTPS." };
  }

  type ConCapabilities = typeof PublicKeyCredential & {
    getClientCapabilities?: () => Promise<Record<string, boolean>>;
  };
  const PKC = window.PublicKeyCredential as ConCapabilities;

  if (typeof PKC.getClientCapabilities === "function") {
    try {
      const c = await PKC.getClientCapabilities();
      if (c["extension:prf"] === false) {
        return {
          disponibile: false,
          motivo: "Il tuo dispositivo o browser non supporta la crittografia biometrica PRF.",
        };
      }
    } catch {
      /* si prosegue con il controllo generico */
    }
  }

  try {
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!platform) {
      return {
        disponibile: false,
        motivo: "Nessun sensore biometrico disponibile su questo dispositivo.",
      };
    }
  } catch {
    return { disponibile: false, motivo: "Impossibile interrogare l'autenticatore." };
  }

  return { disponibile: true };
}

async function chiaveDaPrf(prfOutput: ArrayBuffer): Promise<Bytes> {
  return subkey(new Uint8Array(prfOutput) as Bytes, "pv1:prf:wrap");
}

type RisultatiPrf = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Registra il dispositivo e conserva SK e refresh token cifrati sotto la WK. */
export async function abilita(
  session: Session,
  email: string,
  refreshToken: string
): Promise<void> {
  const supporto = await verificaSupporto();
  if (!supporto.disponibile) throw new Error(supporto.motivo);

  const prfSalt = randomBytes(32);
  const userId = randomBytes(16);

  const credenziale = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Domus", id: window.location.hostname },
      user: { id: userId, name: email, displayName: email },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 60_000,
      // In creazione si chiede solo se il PRF e' attivabile: l'output vero
      // arriva da una `get`, perche' non tutti i browser lo restituiscono qui.
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null;

  if (!credenziale) throw new Error("Registrazione annullata.");

  const estensioni = credenziale.getClientExtensionResults() as RisultatiPrf;
  if (!estensioni.prf?.enabled) {
    throw new Error(
      "Il tuo dispositivo o browser non supporta la crittografia biometrica PRF."
    );
  }

  const credentialId = new Uint8Array(credenziale.rawId);
  const prf = await valutaPrf(credentialId, prfSalt);
  const wk = await chiaveDaPrf(prf);

  const contenuto = new TextEncoder().encode(
    JSON.stringify({ sk: bufferToBase64Url(session.sk), refreshToken })
  ) as Bytes;
  const { nonce, ciphertext } = await seal(wk, contenuto, AAD_PSK);

  await set(CHIAVE, {
    credentialId: bufferToBase64Url(credentialId as Bytes),
    prfSalt: bufferToBase64Url(prfSalt),
    email,
    userId: session.userId,
    isAdmin: session.isAdmin,
    pacchetto: bufferToBase64Url(ciphertext),
    nonce: bufferToBase64Url(nonce),
    creato: new Date().toISOString(),
  } satisfies RecordBiometrico);
}

/** Chiede il gesto biometrico e ricava l'output PRF. */
async function valutaPrf(credentialId: Bytes, prfSalt: Bytes): Promise<ArrayBuffer> {
  const asserzione = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  })) as PublicKeyCredential | null;

  if (!asserzione) throw new Error("Sblocco annullato.");
  const risultato = (asserzione.getClientExtensionResults() as RisultatiPrf).prf?.results?.first;
  if (!risultato) {
    throw new Error("L'autenticatore non ha restituito materiale PRF.");
  }
  return risultato;
}

export interface EsitoSblocco {
  session: Session;
  /** Falso quando il server non risponde o la sessione salvata e' scaduta. */
  online: boolean;
}

/**
 * Sblocca senza master password.
 *
 * Il refresh token ruota a ogni uso: quello conservato vale una volta sola, e
 * va risalvato subito con la WK che in questo momento e' gia' in memoria.
 * Senza, il secondo sblocco fallirebbe — e la reuse detection del server
 * abbatterebbe l'intera famiglia di token.
 */
export async function sblocca(): Promise<EsitoSblocco> {
  const record = await leggiRecord();
  if (!record) throw new Error("Nessuno sblocco biometrico su questo dispositivo.");

  const prfSalt = base64UrlToBuffer(record.prfSalt);
  const prf = await valutaPrf(base64UrlToBuffer(record.credentialId), prfSalt);
  const wk = await chiaveDaPrf(prf);

  let contenuto: { sk: string; refreshToken: string };
  try {
    const raw = await open(
      wk,
      base64UrlToBuffer(record.nonce),
      base64UrlToBuffer(record.pacchetto),
      AAD_PSK
    );
    contenuto = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("Il pacchetto biometrico non e' apribile su questo dispositivo.");
  }

  const sk = base64UrlToBuffer(contenuto.sk);
  const session: Session = {
    userId: record.userId,
    isAdmin: record.isAdmin,
    sk,
    offline: false,
  };

  try {
    const tokens: Tokens = await api.rinnovaSessione(contenuto.refreshToken);
    await risalva(record, wk, sk, tokens.refresh_token);
    return { session: { ...session, isAdmin: tokens.is_admin }, online: true };
  } catch {
    // Server spento o sessione scaduta: la SK e' comunque valida, quindi si
    // apre la copia locale in sola lettura invece di rimandare al login.
    return { session: { ...session, offline: true }, online: false };
  }
}

async function risalva(
  record: RecordBiometrico,
  wk: Bytes,
  sk: Bytes,
  refreshToken: string
): Promise<void> {
  const contenuto = new TextEncoder().encode(
    JSON.stringify({ sk: bufferToBase64Url(sk), refreshToken })
  ) as Bytes;
  const { nonce, ciphertext } = await seal(wk, contenuto, AAD_PSK);
  await set(CHIAVE, {
    ...record,
    pacchetto: bufferToBase64Url(ciphertext),
    nonce: bufferToBase64Url(nonce),
  } satisfies RecordBiometrico);
}

export async function leggiRecord(): Promise<RecordBiometrico | null> {
  try {
    return (await get<RecordBiometrico>(CHIAVE)) ?? null;
  } catch {
    return null;
  }
}

export async function disabilita(): Promise<void> {
  try {
    await del(CHIAVE);
  } catch {
    /* niente da rimuovere */
  }
}
