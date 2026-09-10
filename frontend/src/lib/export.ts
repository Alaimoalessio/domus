import {
  base64UrlToBuffer,
  bufferToBase64Url,
  deriveMasterKey,
  open,
  randomBytes,
  seal,
  subkey,
  utf8,
  type Bytes,
} from "./crypto";
import type { DecryptedItem, ItemPayload } from "./vault";

/**
 * Export del vault in chiaro.
 *
 * E' l'unica funzione dell'applicazione che produce dati leggibili, e il file
 * che genera e' l'oggetto piu' pericoloso di tutto il sistema: un elenco
 * completo di password senza alcuna protezione. La decifratura avviene in RAM
 * e il file non passa mai dal server.
 */

export type FormatoExport = "csv" | "json" | "cifrato";

/** Escape RFC 4180: virgolette raddoppiate, e campo quotato se contiene
 *  virgole, virgolette o a capo. */
function campoCsv(valore: string | undefined): string {
  const v = valore ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Intestazioni compatibili con l'import di Chrome, cosi' il file rientra
 *  anche in altri gestori senza rimappature. */
const INTESTAZIONI = ["name", "url", "username", "password", "note", "totp"] as const;

export function versoCsv(items: DecryptedItem[]): string {
  const righe = [INTESTAZIONI.join(",")];
  for (const i of items) {
    righe.push(
      [
        campoCsv(i.payload.name),
        campoCsv(i.payload.url),
        campoCsv(i.payload.username),
        campoCsv(i.payload.password),
        campoCsv(i.payload.notes),
        campoCsv(i.payload.totp),
      ].join(",")
    );
  }
  return righe.join("\n");
}

export function versoJson(items: DecryptedItem[]): string {
  return JSON.stringify(
    {
      applicazione: "Domus",
      versione: 1,
      esportato: new Date().toISOString(),
      avviso: "Questo file contiene password in chiaro. Cancellalo dopo l'uso.",
      voci: items.map((i) => ({
        nome: i.payload.name,
        url: i.payload.url ?? null,
        username: i.payload.username ?? null,
        password: i.payload.password ?? null,
        note: i.payload.notes ?? null,
        totp: i.payload.totp ?? null,
        creata: i.updatedAt,
      })),
    },
    null,
    2
  );
}

export function nomeFile(formato: FormatoExport): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const quando = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const tipo = formato === "cifrato" ? "backup" : "export";
  const estensione = formato === "csv" ? "csv" : "json";
  return `domus-${tipo}-${quando}.${estensione}`;
}

/**
 * Consegna il file al browser. L'object URL viene revocato subito dopo: e'
 * un riferimento a dati in chiaro tenuti in memoria, e lasciarlo vivo li
 * manterrebbe raggiungibili finche' la pagina resta aperta.
 */
export function scarica(contenuto: string, formato: FormatoExport): void {
  const tipo = formato === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
  const blob = new Blob([contenuto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile(formato);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// ====================================================== export cifrato

/**
 * Backup cifrato con una password scelta dall'utente.
 *
 * E' l'unico backup che dipende da te e non dal server: `scripts/backup.sh`
 * gira sulla macchina che ospita Domus, quindi se quella muore prima che tu
 * l'abbia configurato non resta niente. Questo file lo tieni dove vuoi.
 *
 * La password del file e' volutamente SEPARATA dalla Master Password: un
 * backup finisce su una chiavetta, in un drive, allegato a un'email a te
 * stesso. Riusare la Master Password significherebbe esporla a tutti quei
 * posti, e un file rubato diventerebbe un attacco offline contro la chiave
 * del vault vero.
 */

const FORMATO = "domus.export.cifrato";
const VERSIONE = 1;

/** Piu' pesanti dei parametri di accesso: un backup si apre una volta ogni
 *  tanto, quindi due secondi in piu' non danno fastidio e alzano il costo di
 *  un attacco a forza bruta sul file. */
const KDF_BACKUP = { kdf_memory_kib: 131072, kdf_iterations: 4, kdf_parallelism: 4 };

interface Involucro {
  formato: typeof FORMATO;
  versione: number;
  creato: string;
  kdf: typeof KDF_BACKUP & { salt: string };
  nonce: string;
  ciphertext: string;
}

const AAD_BACKUP = utf8.encode("domus:backup:v1");

export async function versoCifrato(
  items: DecryptedItem[],
  passwordDelFile: string
): Promise<string> {
  const salt = randomBytes(16);
  const chiave = await subkey(
    await deriveMasterKey(passwordDelFile, salt, KDF_BACKUP),
    "domus:backup"
  );

  const contenuto = utf8.encode(
    JSON.stringify({
      voci: items.map((i) => ({
        nome: i.payload.name,
        url: i.payload.url ?? null,
        username: i.payload.username ?? null,
        password: i.payload.password ?? null,
        note: i.payload.notes ?? null,
        totp: i.payload.totp ?? null,
      })),
    })
  ) as Bytes;

  const { nonce, ciphertext } = await seal(chiave, contenuto, AAD_BACKUP);
  const involucro: Involucro = {
    formato: FORMATO,
    versione: VERSIONE,
    creato: new Date().toISOString(),
    kdf: { ...KDF_BACKUP, salt: bufferToBase64Url(salt) },
    nonce: bufferToBase64Url(nonce),
    ciphertext: bufferToBase64Url(ciphertext),
  };
  return JSON.stringify(involucro, null, 2);
}

export class BackupNonValido extends Error {}
export class PasswordDelBackupErrata extends Error {}

export function eBackupCifrato(testo: string): boolean {
  try {
    return JSON.parse(testo)?.formato === FORMATO;
  } catch {
    return false;
  }
}

export async function daCifrato(
  testo: string,
  passwordDelFile: string
): Promise<ItemPayload[]> {
  let involucro: Involucro;
  try {
    involucro = JSON.parse(testo);
  } catch {
    throw new BackupNonValido("Il file non e' leggibile.");
  }
  if (involucro?.formato !== FORMATO) {
    throw new BackupNonValido("Non e' un backup cifrato di Domus.");
  }
  if (involucro.versione > VERSIONE) {
    throw new BackupNonValido(
      "Backup creato da una versione piu' recente di Domus: aggiorna prima di importarlo."
    );
  }

  const chiave = await subkey(
    await deriveMasterKey(passwordDelFile, base64UrlToBuffer(involucro.kdf.salt), involucro.kdf),
    "domus:backup"
  );

  let grezzo: Bytes;
  try {
    grezzo = await open(
      chiave,
      base64UrlToBuffer(involucro.nonce),
      base64UrlToBuffer(involucro.ciphertext),
      AAD_BACKUP
    );
  } catch {
    // AES-GCM non distingue "password errata" da "file manomesso": in entrambi
    // i casi il tag non torna. Si segnala il caso di gran lunga piu' probabile.
    throw new PasswordDelBackupErrata("Password del backup errata, o file danneggiato.");
  }

  const dati = JSON.parse(new TextDecoder().decode(grezzo));
  return (dati.voci ?? []).map(
    (v: Record<string, string | null>): ItemPayload => ({
      name: v.nome ?? "",
      url: v.url ?? undefined,
      username: v.username ?? undefined,
      password: v.password ?? undefined,
      notes: v.note ?? undefined,
      totp: v.totp ?? undefined,
    })
  );
}
