/**
 * Generatore di password e passphrase.
 *
 * Tutto da `crypto.getRandomValues`, mai da `Math.random`. La selezione usa
 * campionamento a rifiuto: `random % n` introduce un bias verso i primi
 * elementi quando n non divide 256, e su un generatore di password quel bias
 * si traduce in entropia reale piu' bassa di quella dichiarata.
 */

const MINUSCOLE = "abcdefghijklmnopqrstuvwxyz";
const MAIUSCOLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CIFRE = "0123456789";
const SIMBOLI = "!#$%&*+-=?@^_~";
/** Coppie che si confondono a leggerle da un foglio o a dettarle a voce. */
const AMBIGUI = new Set("0O1lI5S2Z8B");

export interface OpzioniPassword {
  lunghezza: number;
  maiuscole: boolean;
  minuscole: boolean;
  cifre: boolean;
  simboli: boolean;
  evitaAmbigui: boolean;
}

export const PASSWORD_DEFAULT: OpzioniPassword = {
  lunghezza: 20,
  maiuscole: true,
  minuscole: true,
  cifre: true,
  simboli: true,
  evitaAmbigui: false,
};

/** Indice uniforme in [0, max) senza bias, per qualunque max.
 *  Su 32 bit e non su 8: con una lista di piu' di 256 elementi la soglia
 *  calcolata su un solo byte diventa zero e il ciclo non termina mai. */
function indiceCasuale(max: number): number {
  if (max <= 0) throw new RangeError("max deve essere positivo");
  const spazio = 2 ** 32;
  const soglia = spazio - (spazio % max); // si scarta la coda parziale
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < soglia) return buf[0] % max;
  }
}

function mescola<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = indiceCasuale(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function alfabetoDi(o: OpzioniPassword): string {
  let set = "";
  if (o.minuscole) set += MINUSCOLE;
  if (o.maiuscole) set += MAIUSCOLE;
  if (o.cifre) set += CIFRE;
  if (o.simboli) set += SIMBOLI;
  return o.evitaAmbigui
    ? [...set].filter((c) => !AMBIGUI.has(c)).join("")
    : set;
}

export function generaPassword(o: OpzioniPassword): string {
  const alfabeto = alfabetoDi(o);
  if (alfabeto.length === 0) return "";

  // Un carattere garantito per ogni classe attiva: senza, una password di 20
  // caratteri puo' uscire senza nemmeno una cifra e farsi rifiutare dal sito.
  const obbligatori: string[] = [];
  const classi: [boolean, string][] = [
    [o.minuscole, MINUSCOLE],
    [o.maiuscole, MAIUSCOLE],
    [o.cifre, CIFRE],
    [o.simboli, SIMBOLI],
  ];
  for (const [attiva, set] of classi) {
    if (!attiva) continue;
    const usabili = o.evitaAmbigui ? [...set].filter((c) => !AMBIGUI.has(c)) : [...set];
    if (usabili.length) obbligatori.push(usabili[indiceCasuale(usabili.length)]);
  }

  const resto = Math.max(0, o.lunghezza - obbligatori.length);
  const caratteri = [
    ...obbligatori,
    ...Array.from({ length: resto }, () => alfabeto[indiceCasuale(alfabeto.length)]),
  ];
  return mescola(caratteri).slice(0, o.lunghezza).join("");
}

// --------------------------------------------------------------- passphrase

/**
 * Parole italiane brevi e comuni. L'entropia per parola e' log2(numero di
 * parole) e viene CALCOLATA da entropiaPassphrase, non fissata a mano: cosi'
 * allungare la lista aggiorna il valore mostrato da solo. Sono in italiano
 * perche'
 * una passphrase serve proprio nei casi in cui va DIGITATA a mano — sul
 * telecomando della TV, su una console — e li' l'inglese e' un ostacolo.
 */
export const PAROLE = `abaco abete abito acero acqua aereo affare agenda aglio agosto albero alce alfa alga
alieno alito allarme alloro altare altezza amaca ambra amico ampio anatra ancora anello angolo anima anno
ansia antenna ape aperto arancia arco argento aria arnia arpa arte asilo asino aspetto assedio astro atomo
attico attore aurora autore avena avorio azione azzurro babbo bacio badia bagno balcone balena ballo bambu
banco barca basilico bastone batteria baule becco belva benda bene bianco bibita biglia bilancia binario
birra biscotto bisonte bocca bollo bosco bottone braccio bravo brezza brina brodo bronzo bruco budino bufalo
bugia buio burro busta cabina cactus caduta caffe calamaro calcio caldo calma calza cambio camino campo
canale candela cane canto capra carbone cardine carico carne carota carta casa cascata caserma casello
cassa castoro catena cavallo cavolo cedro cella cemento cena cenere centro cera cerchio cervo cesto chiave
chiodo cibo ciclone cielo ciglio ciliegia cima cinema cinque cipolla circo citta civetta clima cobra cocco
coda colla collina colomba colore colpa comando cometa comune conchiglia condotto confine cono conto coperta
copia corallo corda corno corona corpo corsa corteccia cortile corvo cosa costa cotone cratere creta cresta
cristallo croce crosta cubo cucina cuculo cugino cuore cupola curva cuscino dado danza data dattero decoro
delfino deserto destino dettaglio diamante dicembre difesa diga dintorno dito divano dolce domanda dono dorso
dote dubbio duna duomo ebano eclissi eco edera edicola elenco elica elmo emblema enigma enorme entrata epoca
equatore erba eremo eroe esame esca esilio esito estate estuario etere etica fabbro faccia faggio falco
fame fango fantasia fardello farfalla farina faro fascia fata fatica fava favola felce felpa feltro fenice
ferita fermento ferro festa fetta fiaba fiamma fibbia fico fienile fiera figura fila filo finestra fiocco
fionda fiore firma fiume flauto flotta foca focaccia fodera foglia folata fondo fonte foresta forma fornaio
forno forte fossa fragola frana frase freccia freno fresco frittata frutto fucile fulmine fumo fune fungo
fuoco furto fusto gabbia galassia gallo gamba gancio gara`.trim().split(/\s+/);

export interface OpzioniPassphrase {
  parole: number;
  separatore: string;
  maiuscole: boolean;
  numero: boolean;
}

export const PASSPHRASE_DEFAULT: OpzioniPassphrase = {
  parole: 7,
  separatore: "-",
  maiuscole: false,
  numero: false,
};

export function generaPassphrase(o: OpzioniPassphrase): string {
  const scelte = Array.from({ length: o.parole }, () => PAROLE[indiceCasuale(PAROLE.length)]);
  const parole = o.maiuscole ? scelte.map((p) => p[0].toUpperCase() + p.slice(1)) : scelte;
  const frase = parole.join(o.separatore);
  return o.numero ? `${frase}${o.separatore}${indiceCasuale(100)}` : frase;
}

// ------------------------------------------------------------------ entropia

/** Bit di entropia REALI dello schema di generazione, non una stima
 *  euristica sulla stringa prodotta: qui lo schema lo conosciamo. */
export function entropiaPassword(o: OpzioniPassword): number {
  const n = alfabetoDi(o).length;
  return n <= 1 ? 0 : Math.floor(o.lunghezza * Math.log2(n));
}

export function entropiaPassphrase(o: OpzioniPassphrase): number {
  const bitPerParola = Math.log2(PAROLE.length);
  return Math.floor(o.parole * bitPerParola + (o.numero ? Math.log2(100) : 0));
}

export function giudizio(bit: number): { etichetta: string; classe: string; quota: number } {
  if (bit < 50) return { etichetta: "debole", classe: "bg-red-500", quota: 25 };
  if (bit < 70) return { etichetta: "discreta", classe: "bg-amber-500", quota: 50 };
  if (bit < 100) return { etichetta: "forte", classe: "bg-emerald-500", quota: 75 };
  return { etichetta: "eccellente", classe: "bg-emerald-400", quota: 100 };
}
