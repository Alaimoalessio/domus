import type { DecryptedItem } from "./vault";

/**
 * Controllo delle password comparse in violazioni note (Have I Been Pwned).
 *
 * COME FUNZIONA. Si calcola SHA-1 della password, si mandano i PRIMI CINQUE
 * caratteri esadecimali del digest, e il servizio risponde con tutti i suffissi
 * che iniziano con quel prefisso — tipicamente qualche centinaio. Il confronto
 * avviene qui. La password non lascia il dispositivo, e nemmeno il suo hash
 * completo: 5 caratteri su 40 identificano circa un milione di hash possibili.
 *
 * PERCHE' NON E' AUTOMATICO. E' l'unica funzione di Domus che apre una
 * connessione verso internet, da un'applicazione pensata per vivere dietro una
 * VPN. Anche senza rivelare le password, il traffico dice a un terzo che a un
 * certo indirizzo IP qualcuno sta controllando delle credenziali. Per questo si
 * avvia solo su richiesta esplicita, un pulsante alla volta, e mai in
 * sottofondo.
 *
 * SHA-1 e' l'algoritmo richiesto dall'API. Qui non serve resistenza alle
 * collisioni: si sta cercando una corrispondenza in un elenco, non firmando
 * nulla.
 */

const ENDPOINT = "https://api.pwnedpasswords.com/range/";

export interface EsitoCompromissione {
  item: DecryptedItem;
  occorrenze: number;
}

export class ControlloNonRiuscito extends Error {}

async function sha1Hex(testo: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(testo));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Quante volte quella password compare nelle violazioni note. 0 = mai vista. */
export async function contaOccorrenze(password: string): Promise<number> {
  const hash = await sha1Hex(password);
  const prefisso = hash.slice(0, 5);
  const suffisso = hash.slice(5);

  let risposta: Response;
  try {
    risposta = await fetch(`${ENDPOINT}${prefisso}`, {
      headers: { "Add-Padding": "true" },
    });
  } catch {
    // Senza rete — il caso normale se Domus gira su una macchina isolata.
    throw new ControlloNonRiuscito(
      "Impossibile raggiungere il servizio: serve una connessione a internet."
    );
  }
  if (!risposta.ok) {
    throw new ControlloNonRiuscito(`Il servizio ha risposto ${risposta.status}.`);
  }

  for (const riga of (await risposta.text()).split("\n")) {
    const [coda, conteggio] = riga.trim().split(":");
    if (coda === suffisso) return Number(conteggio) || 0;
  }
  return 0;
}

/**
 * Controlla tutte le voci con password. Le password identiche si interrogano
 * una volta sola: stesso hash, stessa risposta, e ogni richiesta in meno e'
 * traffico in meno verso l'esterno.
 */
export async function controllaTutte(
  items: DecryptedItem[],
  onAvanzamento?: (fatte: number, totali: number) => void
): Promise<EsitoCompromissione[]> {
  const conPassword = items.filter((i) => (i.payload.password ?? "").length > 0);
  const uniche = [...new Set(conPassword.map((i) => i.payload.password!))];
  const conteggi = new Map<string, number>();

  for (const [indice, password] of uniche.entries()) {
    conteggi.set(password, await contaOccorrenze(password));
    onAvanzamento?.(indice + 1, uniche.length);
  }

  return conPassword
    .map((item) => ({ item, occorrenze: conteggi.get(item.payload.password!) ?? 0 }))
    .filter((e) => e.occorrenze > 0)
    .sort((a, b) => b.occorrenze - a.occorrenze);
}
