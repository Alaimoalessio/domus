import { clear, del, get, set } from "idb-keyval";

import { ApiError, type FileOut, type ItemOut } from "./api";

/**
 * Cache offline in IndexedDB.
 *
 * COSA CI FINISCE: esattamente cio' che il server gia' possiede — ciphertext
 * degli item, chiavi di item wrappate, la SK wrappata (`protected_symmetric_key`)
 * e i parametri KDF. Nulla di piu'. La master key non viene mai scritta, e
 * senza la master password questo snapshot e' inerte quanto il database del
 * server.
 *
 * COSA CAMBIA NEL MODELLO DI MINACCIA: chi ruba il dispositivo ottiene il
 * materiale per un attacco a forza bruta offline sulla master password, senza
 * dover passare dal rate limiting del server. La difesa e' Argon2id con 64 MiB
 * e 3 iterazioni — la stessa che protegge il vault sul server — piu' la
 * cifratura del disco del telefono. E' il prezzo dell'accesso offline: e' il
 * motivo per cui si puo' cancellare la cache dalle impostazioni.
 */

const CHIAVE = "domus:snapshot:v1";

export interface Snapshot {
  email: string;
  userId: string;
  isAdmin: boolean;
  /** Parametri per rideriv la master key senza contattare /auth/prelogin. */
  kdf: {
    kdf_salt: string;
    kdf_memory_kib: number;
    kdf_iterations: number;
    kdf_parallelism: number;
  };
  /** SK wrappata sotto la KEK: opaca senza la master password. */
  protected_symmetric_key: string;
  protected_key_nonce: string;
  /** Il vault cosi' come arriva dal server: cifrato. */
  items: ItemOut[];
  files: FileOut[];
  seq: number;
  salvato: string;
}

export async function salvaSnapshot(s: Snapshot): Promise<void> {
  try {
    await set(CHIAVE, s);
  } catch {
    // Modalita' privata, quota esaurita, storage disabilitato: l'app deve
    // continuare a funzionare online anche senza cache.
  }
}

export async function leggiSnapshot(): Promise<Snapshot | null> {
  try {
    return (await get<Snapshot>(CHIAVE)) ?? null;
  } catch {
    return null;
  }
}

export async function cancellaSnapshot(): Promise<void> {
  try {
    await del(CHIAVE);
    await clear();
  } catch {
    /* niente da cancellare */
  }
}

/**
 * Distingue "server irraggiungibile" da "server che ha risposto no".
 *
 * Un TypeError da fetch non basta: quando c'e' un proxy davanti — Vite in
 * sviluppo, Caddy in produzione — un backend spento non produce un errore di
 * rete, produce un 502. La fetch riesce, e senza questo controllo la modalita'
 * offline non scatterebbe mai proprio nel caso per cui e' stata scritta.
 *
 * 502/503/504 sono errori di GATEWAY: significano che chi sta davanti non
 * riesce a parlare con il backend. Il 500 resta fuori di proposito — li'
 * l'applicazione ha risposto, e ha sbagliato: nasconderlo dietro una copia
 * locale mascherebbe un guasto vero.
 *
 * Un 401 non deve MAI far scattare l'offline: le credenziali sono sbagliate,
 * e aprire comunque il vault dalla cache annullerebbe l'autenticazione.
 */
const GATEWAY_GIU = new Set([502, 503, 504]);

export function eProblemaDiRete(err: unknown): boolean {
  if (err instanceof TypeError) return true;             // connessione rifiutata, DNS, offline
  if (err instanceof ApiError) return GATEWAY_GIU.has(err.status);
  return err instanceof Error && err.name === "TypeError";
}
