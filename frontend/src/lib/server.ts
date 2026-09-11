/**
 * Indirizzo del server quando Domus gira come app nativa (Tauri su Mac,
 * Capacitor su Android). Nel browser il frontend e' servito dal backend
 * stesso e le chiamate restano relative: questo modulo non entra in gioco.
 *
 * Nell'app nativa il frontend e' impacchettato dentro l'eseguibile, quindi
 * il server riceve solo cio' che riceverebbe comunque: ciphertext e hash
 * dell'auth key. Puntare l'app a un server sbagliato non puo' far uscire
 * nulla in chiaro — non c'e' una pagina remota da avvelenare.
 */

const CHIAVE = "domus.server";

interface FinestraNativa extends Window {
  __TAURI_INTERNALS__?: unknown;
  Capacitor?: { isNativePlatform?: () => boolean };
}

export function eAppNativa(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as FinestraNativa;
  if (w.__TAURI_INTERNALS__) return true;
  if (w.Capacitor?.isNativePlatform?.()) return true;
  return false;
}

/** Ritorna l'URL normalizzato oppure un messaggio d'errore. */
export function normalizzaServer(grezzo: string): { url: string } | { errore: string } {
  const testo = grezzo.trim().replace(/\/+$/, "");
  if (!testo) return { errore: "Inserisci l'indirizzo del server." };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(testo) ? testo : `https://${testo}`);
  } catch {
    return { errore: "Indirizzo non valido." };
  }
  if (u.username || u.password || u.search || u.hash) {
    return { errore: "L'indirizzo non puo' contenere credenziali o parametri." };
  }
  const locale = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  // Senza TLS l'auth key viaggerebbe in chiaro sulla rete: si tollera solo
  // verso la macchina stessa, per le prove.
  if (u.protocol === "http:" && !locale) {
    return { errore: "Serve https:// (http va bene solo verso localhost)." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { errore: "Sono ammessi solo http e https." };
  }
  const percorso = u.pathname.replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host}${percorso}` };
}

export function leggiServer(): string | null {
  try {
    const v = localStorage.getItem(CHIAVE);
    if (!v) return null;
    const esito = normalizzaServer(v);
    return "url" in esito ? esito.url : null;
  } catch {
    return null;
  }
}

export function salvaServer(url: string): void {
  localStorage.setItem(CHIAVE, url);
}

export function dimenticaServer(): void {
  localStorage.removeItem(CHIAVE);
}

/** Prefisso per tutte le chiamate API. Vuoto nel browser: stessa origine. */
export function baseApi(): string {
  const s = eAppNativa() ? leggiServer() : null;
  return `${s ?? ""}/api/v1`;
}

/** Controlla che all'indirizzo risponda davvero un backend Domus. */
export async function verificaServer(url: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Il server ha risposto ${r.status}.`);
    const corpo = (await r.json()) as { status?: string };
    if (corpo.status !== "ok") throw new Error("Non sembra un server Domus.");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Il server non risponde (timeout).");
    }
    if (err instanceof TypeError) {
      throw new Error("Impossibile raggiungere il server. Sei connesso alla VPN?");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
