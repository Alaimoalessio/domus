import type { ItemPayload } from "./vault";

/**
 * Import da altri gestori di password.
 *
 * Tutto lato client: il CSV non lascia mai il browser in chiaro. Le voci
 * vengono cifrate una per una e solo il ciphertext raggiunge il server.
 */

/** Parser CSV conforme a RFC 4180: gestisce virgolette, virgolette raddoppiate
 *  e a capo dentro i campi. Uno `split(",")` rovinerebbe ogni nota multiriga
 *  e ogni password che contiene una virgola. */
export function parseCsv(testo: string): string[][] {
  const righe: string[][] = [];
  let riga: string[] = [];
  let campo = "";
  let traVirgolette = false;

  const testoNorm = testo.replace(/^﻿/, ""); // BOM di Excel

  for (let i = 0; i < testoNorm.length; i++) {
    const c = testoNorm[i];

    if (traVirgolette) {
      if (c === '"') {
        if (testoNorm[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          traVirgolette = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') traVirgolette = true;
    else if (c === ",") {
      riga.push(campo);
      campo = "";
    } else if (c === "\r") continue;
    else if (c === "\n") {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = "";
    } else campo += c;
  }

  if (campo !== "" || riga.length > 0) {
    riga.push(campo);
    righe.push(riga);
  }
  return righe.filter((r) => r.some((v) => v.trim() !== ""));
}

export type Formato = "chrome" | "bitwarden" | "1password" | "generico";

/** Nomi di colonna per ciascun campo, in ordine di preferenza. Il
 *  riconoscimento e' per intestazione e non per posizione: le colonne cambiano
 *  ordine fra versioni dello stesso gestore. */
const COLONNE: Record<keyof ItemPayload, string[]> = {
  name: ["name", "title", "nome", "titolo", "account"],
  username: ["username", "login_username", "user", "utente", "email", "login"],
  password: ["password", "login_password", "pass"],
  url: ["url", "login_uri", "website", "site", "uri", "sito"],
  notes: ["notes", "note", "comment", "commenti"],
  totp: ["totp", "login_totp", "otpauth", "otp", "two_factor", "2fa"],
};

export function riconosciFormato(intestazioni: string[]): Formato {
  const h = intestazioni.map((x) => x.trim().toLowerCase());
  if (h.includes("login_password") && h.includes("login_uri")) return "bitwarden";
  if (h.includes("otpauth") || (h.includes("title") && h.includes("url"))) return "1password";
  if (h.includes("name") && h.includes("url") && h.includes("password")) return "chrome";
  return "generico";
}

export const NOME_FORMATO: Record<Formato, string> = {
  chrome: "Chrome / Edge / Brave",
  bitwarden: "Bitwarden",
  "1password": "1Password",
  generico: "CSV generico",
};

export interface VoceImportata {
  payload: ItemPayload;
  /** Motivo per cui la riga non e' importabile, se lo e'. */
  scarto?: string;
}

export interface RisultatoAnalisi {
  formato: Formato;
  intestazioni: string[];
  voci: VoceImportata[];
  importabili: number;
}

export function analizza(testo: string): RisultatoAnalisi {
  const righe = parseCsv(testo);
  if (righe.length < 2) {
    return { formato: "generico", intestazioni: [], voci: [], importabili: 0 };
  }

  const intestazioni = righe[0].map((x) => x.trim().toLowerCase());
  const indice = (campo: keyof ItemPayload): number => {
    for (const nome of COLONNE[campo]) {
      const i = intestazioni.indexOf(nome);
      if (i >= 0) return i;
    }
    return -1;
  };
  const mappa = {
    name: indice("name"),
    username: indice("username"),
    password: indice("password"),
    url: indice("url"),
    notes: indice("notes"),
    totp: indice("totp"),
  };

  const voci = righe.slice(1).map((r): VoceImportata => {
    const leggi = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const url = leggi(mappa.url);
    // Il nome e' l'unico campo obbligatorio; se manca si ripiega sul dominio,
    // perche' scartare una password solo perche' il titolo e' vuoto sarebbe
    // il modo peggiore di perdere dati durante una migrazione.
    let name = leggi(mappa.name);
    if (!name && url) {
      try {
        name = new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
      } catch {
        name = url;
      }
    }

    const payload: ItemPayload = {
      name,
      username: leggi(mappa.username) || undefined,
      password: leggi(mappa.password) || undefined,
      url: url || undefined,
      notes: leggi(mappa.notes) || undefined,
      totp: leggi(mappa.totp) || undefined,
    };

    if (!name) return { payload, scarto: "senza nome e senza URL" };
    if (!payload.password && !payload.notes && !payload.totp) {
      return { payload, scarto: "nessun segreto da salvare" };
    }
    return { payload };
  });

  return {
    formato: riconosciFormato(intestazioni),
    intestazioni,
    voci,
    importabili: voci.filter((v) => !v.scarto).length,
  };
}
