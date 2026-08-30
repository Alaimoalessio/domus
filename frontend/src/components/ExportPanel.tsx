import { Download, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { scarica, versoCsv, versoJson, type FormatoExport } from "../lib/export";
import { syncVault, type Session } from "../lib/vault";
import { Button } from "./ui/button";

export function ExportPanel({ session }: { session: Session }) {
  const [formato, setFormato] = useState<FormatoExport>("csv");
  const [confermato, setConfermato] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState("");

  const esporta = async () => {
    setBusy(true);
    setErrore("");
    try {
      // Si rilegge dal server e si decifra al momento: esportare da una copia
      // in memoria rischierebbe di produrre un file gia' vecchio.
      const stato = await syncVault(session, null);
      const contenuto = formato === "csv" ? versoCsv(stato.items) : versoJson(stato.items);
      scarica(contenuto, formato);
      setConfermato(false);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Export non riuscito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-3 text-sm text-red-200/90">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div>
          Il file esportato contiene <strong>tutte le password in chiaro</strong>, senza alcuna
          protezione. E' l'oggetto piu' pericoloso di tutto il sistema: non lasciarlo nella
          cartella Download, non mandarlo per email, cancellalo appena l'hai usato.
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-neutral-800 p-0.5">
        {(["csv", "json"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFormato(f)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium uppercase transition ${
              formato === f ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        {formato === "csv"
          ? "Colonne compatibili con Chrome e Bitwarden: rientra in altri gestori senza rimappature. Gli allegati non sono inclusi."
          : "Struttura completa con le date di modifica. Gli allegati non sono inclusi."}
      </p>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={confermato}
          onChange={(e) => setConfermato(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-red-500"
        />
        Ho capito che il file conterra' le password in chiaro.
      </label>

      {errore && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errore}
        </div>
      )}

      <Button variant="destructive" disabled={!confermato || busy} onClick={esporta}>
        <Download className="mr-2 h-4 w-4" />
        {busy ? "Decifratura..." : `Esporta in ${formato.toUpperCase()}`}
      </Button>
    </div>
  );
}
