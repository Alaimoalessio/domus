import type { DecryptedItem } from "./vault";

/**
 * Export del vault in chiaro.
 *
 * E' l'unica funzione dell'applicazione che produce dati leggibili, e il file
 * che genera e' l'oggetto piu' pericoloso di tutto il sistema: un elenco
 * completo di password senza alcuna protezione. La decifratura avviene in RAM
 * e il file non passa mai dal server.
 */

export type FormatoExport = "csv" | "json";

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
  return `domus-export-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${formato}`;
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
