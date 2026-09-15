import { leggiPreferenze } from "./preferenze";

/**
 * Copia un segreto negli appunti e li svuota da soli dopo il tempo scelto
 * nelle impostazioni. La clipboard e' leggibile da qualunque app: una
 * password lasciata li' e' una password lasciata in giro.
 */
export async function copiaSegreto(testo: string): Promise<void> {
  if (!testo) return;
  await navigator.clipboard.writeText(testo);
  const secondi = leggiPreferenze().secondiClipboard;
  if (secondi === 0) return;
  window.setTimeout(async () => {
    try {
      const attuale = await navigator.clipboard.readText();
      if (attuale === testo) await navigator.clipboard.writeText("");
    } catch {
      // Senza permesso di lettura si svuota comunque: meglio perdere un
      // "copia" altrui che lasciare una password in giro.
      await navigator.clipboard.writeText("").catch(() => {});
    }
  }, secondi * 1000);
}
