import { CreditCard, Globe, KeyRound, StickyNote, type LucideIcon } from "lucide-react";

/**
 * Tipi di voce.
 *
 * `item_type` e' l'unico metadato che viaggia in chiaro, ed e' una scelta
 * consapevole gia' presa quando e' nato il backend: permette filtri e conteggi
 * senza decifrare. Tutto il resto — compresi i campi specifici di ogni tipo —
 * sta dentro il payload cifrato.
 */

export type TipoVoce = "login" | "nota" | "carta" | "altro";

export interface DescrizioneTipo {
  chiave: TipoVoce;
  etichetta: string;
  icona: LucideIcon;
  /** Quali campi mostrare nella maschera. Il nome c'e' sempre. */
  campi: {
    username?: boolean;
    password?: boolean;
    url?: boolean;
    totp?: boolean;
    carta?: boolean;
  };
  suggerimento: string;
}

export const TIPI: Record<TipoVoce, DescrizioneTipo> = {
  login: {
    chiave: "login",
    etichetta: "Accesso",
    icona: Globe,
    campi: { username: true, password: true, url: true, totp: true },
    suggerimento: "Un sito o un'app con utente e password.",
  },
  nota: {
    chiave: "nota",
    etichetta: "Nota sicura",
    icona: StickyNote,
    campi: {},
    suggerimento: "Codice fiscale, PIN, chiavi di licenza, la password del wifi.",
  },
  carta: {
    chiave: "carta",
    etichetta: "Carta",
    icona: CreditCard,
    campi: { carta: true },
    suggerimento:
      "Tessere fedelta', carte regalo, abbonamenti. Le carte di pagamento tienile su Vaultwarden.",
  },
  altro: {
    chiave: "altro",
    etichetta: "Altro",
    icona: KeyRound,
    campi: { username: true, password: true, url: true, totp: true },
    suggerimento: "Tutto il resto.",
  },
};

export const ORDINE_TIPI: TipoVoce[] = ["login", "nota", "carta", "altro"];

/** Un tipo sconosciuto (arrivato da una versione futura o da un import) non
 *  deve far sparire la voce: ricade su "altro", che mostra tutti i campi. */
export function descrizione(tipo: string): DescrizioneTipo {
  return TIPI[tipo as TipoVoce] ?? TIPI.altro;
}
