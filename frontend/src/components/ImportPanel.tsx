import { CheckCircle2, FileUp, Loader2, Lock, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { daCifrato, eBackupCifrato, PasswordDelBackupErrata } from "../lib/export";
import { NOME_FORMATO, analizza, type RisultatoAnalisi } from "../lib/import";
import { createItem, type Session } from "../lib/vault";
import { Button } from "./ui/button";

type Fase = "scelta" | "password" | "anteprima" | "importazione" | "fatto";

export function ImportPanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const [fase, setFase] = useState<Fase>("scelta");
  const [analisi, setAnalisi] = useState<RisultatoAnalisi | null>(null);
  const [fatte, setFatte] = useState(0);
  const [fallite, setFallite] = useState<string[]>([]);
  const [errore, setErrore] = useState("");
  // Un backup cifrato non si puo' analizzare finche' non lo si apre: il
  // contenuto del file, a differenza di un CSV, non e' leggibile.
  const [testoCifrato, setTestoCifrato] = useState("");
  const [passwordFile, setPasswordFile] = useState("");
  const [apertura, setApertura] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const scegli = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrore("");
    try {
      const testo = await file.text();
      if (eBackupCifrato(testo)) {
        setTestoCifrato(testo);
        setFase("password");
        return;
      }
      const risultato = analizza(testo);
      if (risultato.voci.length === 0) {
        setErrore("Il file non contiene righe leggibili.");
        return;
      }
      setAnalisi(risultato);
      setFase("anteprima");
    } catch {
      setErrore("Impossibile leggere il file: deve essere un CSV o un backup di Domus.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const apriBackup = async () => {
    setApertura(true);
    setErrore("");
    try {
      const voci = await daCifrato(testoCifrato, passwordFile);
      setAnalisi({
        formato: "generico",
        intestazioni: [],
        voci: voci.map((payload) => ({
          payload,
          scarto: payload.name ? undefined : "senza nome",
        })),
        importabili: voci.filter((v) => v.name).length,
      });
      setPasswordFile("");
      setFase("anteprima");
    } catch (err) {
      setErrore(
        err instanceof PasswordDelBackupErrata
          ? err.message
          : err instanceof Error
            ? err.message
            : "Apertura non riuscita"
      );
    } finally {
      setApertura(false);
    }
  };

  const importa = async () => {
    if (!analisi) return;
    setFase("importazione");
    const errori: string[] = [];
    let n = 0;
    // Una alla volta: ogni voce e' una POST e il server e' su SQLite, che ha
    // un solo scrittore. In parallelo si guadagnerebbe poco e si rischierebbe
    // di far scattare il busy_timeout.
    for (const voce of analisi.voci) {
      if (voce.scarto) continue;
      try {
        await createItem(session, "login", voce.payload);
      } catch (err) {
        errori.push(`${voce.payload.name}: ${err instanceof Error ? err.message : "errore"}`);
      }
      setFatte(++n);
    }
    setFallite(errori);
    setFase("fatto");
    onDone();
  };

  if (fase === "fatto" && analisi) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {fatte - fallite.length} voci importate e cifrate.
            {fallite.length > 0 && ` ${fallite.length} non riuscite.`}
          </span>
        </div>
        {fallite.length > 0 && (
          <ul className="max-h-32 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
            {fallite.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFase("scelta");
            setAnalisi(null);
            setFatte(0);
            setFallite([]);
          }}
        >
          Importa un altro file
        </Button>
      </div>
    );
  }

  if (fase === "importazione" && analisi) {
    const quota = analisi.importabili ? (fatte / analisi.importabili) * 100 : 0;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-indigo-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cifratura e caricamento: {fatte} di {analisi.importabili}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${quota}%` }}
          />
        </div>
      </div>
    );
  }

  if (fase === "password") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-200/90">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          Backup cifrato di Domus. Serve la password scelta quando e' stato creato — non la
          Master Password.
        </div>
        <input
          type="password"
          autoComplete="off"
          value={passwordFile}
          onChange={(e) => setPasswordFile(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && passwordFile) void apriBackup();
          }}
          placeholder="Password del backup"
          className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 sm:text-sm"
        />
        {errore && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {errore}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFase("scelta");
              setTestoCifrato("");
              setPasswordFile("");
              setErrore("");
            }}
          >
            Annulla
          </Button>
          <Button size="sm" onClick={apriBackup} disabled={!passwordFile || apertura}>
            {apertura ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Apertura...
              </>
            ) : (
              "Apri il backup"
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (fase === "anteprima" && analisi) {
    const scartate = analisi.voci.length - analisi.importabili;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-neutral-400">Formato riconosciuto</span>
            <span className="font-medium text-neutral-100">{NOME_FORMATO[analisi.formato]}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-400">Voci importabili</span>
            <span className="font-medium text-neutral-100">
              {analisi.importabili}
              {scartate > 0 && <span className="text-neutral-500"> ({scartate} scartate)</span>}
            </span>
          </div>
        </div>

        <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-neutral-900 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Utente</th>
                <th className="px-3 py-2 font-medium">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 bg-neutral-950">
              {analisi.voci.slice(0, 50).map((v, i) => (
                <tr key={i} className={v.scarto ? "opacity-40" : ""}>
                  <td className="truncate px-3 py-1.5 text-neutral-200">{v.payload.name || "—"}</td>
                  <td className="truncate px-3 py-1.5 text-neutral-500">
                    {v.payload.username || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-500">
                    {v.scarto ?? (v.payload.totp ? "con 2FA" : "ok")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {analisi.voci.length > 50 && (
            <div className="border-t border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500">
              e altre {analisi.voci.length - 50}...
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setFase("scelta")}>
            Annulla
          </Button>
          <Button size="sm" onClick={importa} disabled={analisi.importabili === 0}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Importa {analisi.importabili} voci
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-400">
        Da Chrome, Bitwarden, 1Password, un CSV generico o un backup cifrato di Domus. Il file
        viene letto e cifrato qui: in chiaro non lascia mai il browser.
      </p>
      {errore && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {errore}
        </div>
      )}
      <Button variant="outline" onClick={() => input.current?.click()}>
        <FileUp className="mr-2 h-4 w-4" /> Scegli un file
      </Button>
      <input
        ref={input}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={scegli}
      />
      <p className="text-xs text-neutral-600">
        Dopo l'importazione, cancella il CSV dal disco: e' un elenco di password in chiaro.
      </p>
    </div>
  );
}
