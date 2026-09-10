import { Download, Lock, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { scarica, versoCifrato, versoCsv, versoJson, type FormatoExport } from "../lib/export";
import { syncVault, type Session } from "../lib/vault";
import { Button } from "./ui/button";

export function ExportPanel({ session }: { session: Session }) {
  const [formato, setFormato] = useState<FormatoExport>("csv");
  const [confermato, setConfermato] = useState(false);
  const [passwordFile, setPasswordFile] = useState("");
  const [conferma, setConferma] = useState("");
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState("");

  const cifrato = formato === "cifrato";

  const esporta = async () => {
    if (cifrato) {
      if (passwordFile !== conferma) return setErrore("Le password non corrispondono");
      if (passwordFile.length < 12) {
        return setErrore("La password del backup deve avere almeno 12 caratteri");
      }
    }
    setBusy(true);
    setErrore("");
    try {
      // Si rilegge dal server e si decifra al momento: esportare da una copia
      // in memoria rischierebbe di produrre un file gia' vecchio.
      const stato = await syncVault(session, null);
      const contenuto = cifrato
        ? await versoCifrato(stato.items, passwordFile)
        : formato === "csv"
          ? versoCsv(stato.items)
          : versoJson(stato.items);
      scarica(contenuto, formato);
      setConfermato(false);
      setPasswordFile("");
      setConferma("");
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Export non riuscito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {cifrato ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-200/90">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div>
            Backup <strong>cifrato</strong>: puoi tenerlo su una chiavetta o in un drive. E'
            l'unico backup che dipende da te — quello sul server serve a poco se e' il server a
            rompersi.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-3 text-sm text-red-200/90">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            Il file esportato contiene <strong>tutte le password in chiaro</strong>, senza alcuna
            protezione. E' l'oggetto piu' pericoloso di tutto il sistema: non lasciarlo nella
            cartella Download, non mandarlo per email, cancellalo appena l'hai usato.
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-lg border border-neutral-800 p-0.5">
        {(["cifrato", "csv", "json"] as const).map((f) => (
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
        {cifrato
          ? "Riapribile solo da Domus, con la password che scegli qui sotto. Gli allegati non sono inclusi."
          : formato === "csv"
            ? "Colonne compatibili con Chrome e Bitwarden: rientra in altri gestori senza rimappature. Gli allegati non sono inclusi."
            : "Struttura completa con le date di modifica. Gli allegati non sono inclusi."}
      </p>

      {cifrato && (
        <div className="space-y-3">
          <Campo
            id="pw-backup"
            label="Password del backup"
            value={passwordFile}
            onChange={(e) => setPasswordFile(e.target.value)}
          />
          <Campo
            id="pw-backup-conferma"
            label="Conferma"
            value={conferma}
            onChange={(e) => setConferma(e.target.value)}
          />
          <p className="text-xs leading-relaxed text-neutral-600">
            Scegline una <strong>diversa</strong> dalla Master Password. Un backup finisce su una
            chiavetta o in un drive: riusare la Master Password la esporrebbe a tutti quei posti,
            e un file rubato diventerebbe un attacco contro il vault vero. Se la dimentichi, il
            backup e' perso — non c'e' modo di recuperarlo.
          </p>
        </div>
      )}

      {!cifrato && (
        <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={confermato}
            onChange={(e) => setConfermato(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-red-500"
          />
          Ho capito che il file conterra' le password in chiaro.
        </label>
      )}

      {errore && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errore}
        </div>
      )}

      <Button
        variant={cifrato ? "default" : "destructive"}
        disabled={busy || (!cifrato && !confermato) || (cifrato && (!passwordFile || !conferma))}
        onClick={esporta}
      >
        <Download className="mr-2 h-4 w-4" />
        {busy
          ? cifrato
            ? "Cifratura del backup..."
            : "Decifratura..."
          : cifrato
            ? "Crea il backup cifrato"
            : `Esporta in ${formato.toUpperCase()}`}
      </Button>
    </div>
  );
}

function Campo({
  id,
  label,
  ...props
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-neutral-300">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        {...props}
        className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 sm:text-sm"
      />
    </div>
  );
}
