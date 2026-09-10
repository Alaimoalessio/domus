import type { DecryptedItem } from "./vault";

/**
 * Controllo di igiene del vault: password riutilizzate, deboli, vecchie.
 *
 * Tutto in locale, sulle voci gia' decifrate in memoria. Nessuna chiamata
 * verso l'esterno — in particolare NON si interroga Have I Been Pwned: anche
 * con la k-anonymity, che manda solo cinque caratteri dell'hash, sarebbe la
 * prima connessione che Domus apre verso internet da una macchina che vive
 * dietro una VPN. Se un giorno lo si vuole, va fatto dal browser e su richiesta
 * esplicita, mai in automatico.
 */

export type Gravita = "alta" | "media";

export interface Problema {
  tipo: "riutilizzata" | "debole" | "vecchia";
  gravita: Gravita;
  titolo: string;
  dettaglio: string;
  voci: DecryptedItem[];
}

const UN_ANNO = 365 * 24 * 60 * 60 * 1000;

/**
 * Stima dell'entropia di una password ALTRUI, cioe' di cui non conosciamo lo
 * schema di generazione. E' per forza euristica: si guarda quanto e' grande
 * l'alfabeto usato e quanto e' lunga. Sovrastima le password "furbe" tipo
 * Password1! — per quelle c'e' il controllo sugli schemi comuni qui sotto.
 */
export function entropiaStimata(pw: string): number {
  let alfabeto = 0;
  if (/[a-z]/.test(pw)) alfabeto += 26;
  if (/[A-Z]/.test(pw)) alfabeto += 26;
  if (/[0-9]/.test(pw)) alfabeto += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) alfabeto += 32;
  if (alfabeto === 0) return 0;
  return Math.floor(pw.length * Math.log2(alfabeto));
}

const SCHEMI_COMUNI = [
  /^[a-z]+\d{1,4}!?$/i, // parola + anno
  /^(password|passw0rd|qwerty|asdf|1234|admin|letmein|iloveyou|juventus|milan|inter)/i,
  /^(\d)\1+$/, // cifre ripetute
  /^(19|20)\d{2}$/, // un anno e basta
];

export function eDebole(pw: string): boolean {
  if (pw.length < 10) return true;
  if (SCHEMI_COMUNI.some((r) => r.test(pw))) return true;
  return entropiaStimata(pw) < 50;
}

export function analizzaSalute(items: DecryptedItem[]): Problema[] {
  const conPassword = items.filter((i) => (i.payload.password ?? "").length > 0);
  const problemi: Problema[] = [];

  // Riutilizzo: e' il difetto piu' grave, perche' trasforma la violazione di
  // un sito qualunque nella violazione di tutti gli altri.
  const perPassword = new Map<string, DecryptedItem[]>();
  for (const i of conPassword) {
    const pw = i.payload.password!;
    perPassword.set(pw, [...(perPassword.get(pw) ?? []), i]);
  }
  const riutilizzate = [...perPassword.values()].filter((g) => g.length > 1);
  if (riutilizzate.length > 0) {
    problemi.push({
      tipo: "riutilizzata",
      gravita: "alta",
      titolo: `${riutilizzate.flat().length} voci con password riutilizzate`,
      dettaglio:
        "La stessa password su piu' siti: se ne bucano uno, entrano ovunque. E' il problema che un gestore di password dovrebbe risolvere.",
      voci: riutilizzate.flat(),
    });
  }

  const deboli = conPassword.filter((i) => eDebole(i.payload.password!));
  if (deboli.length > 0) {
    problemi.push({
      tipo: "debole",
      gravita: "alta",
      titolo: `${deboli.length} password deboli`,
      dettaglio:
        "Corte, prevedibili o basate su schemi comuni. Il generatore ne produce di nuove in un secondo.",
      voci: deboli,
    });
  }

  const limite = Date.now() - UN_ANNO;
  const vecchie = conPassword.filter((i) => new Date(i.updatedAt).getTime() < limite);
  if (vecchie.length > 0) {
    problemi.push({
      tipo: "vecchia",
      gravita: "media",
      titolo: `${vecchie.length} password non cambiate da oltre un anno`,
      dettaglio:
        "Non e' un'emergenza: cambiarle a caso non serve. Vale la pena farlo dove il sito ha avuto violazioni note.",
      voci: vecchie,
    });
  }

  return problemi;
}
