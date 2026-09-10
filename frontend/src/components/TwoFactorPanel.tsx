import { Check, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type TotpSetup, type TotpStatus } from "../lib/api";
import { Button } from "./ui/button";

export function TwoFactorPanel() {
  const [stato, setStato] = useState<TotpStatus | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codice, setCodice] = useState("");
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState("");

  const ricarica = useCallback(async () => {
    try {
      setStato(await api.totpStatus());
    } catch {
      /* la pagina resta usabile anche senza */
    }
  }, []);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  const avvia = async () => {
    setBusy(true);
    setErrore("");
    try {
      setSetup(await api.totpSetup());
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Configurazione non riuscita");
    } finally {
      setBusy(false);
    }
  };

  const attiva = async () => {
    setBusy(true);
    setErrore("");
    try {
      await api.totpActivate(codice);
      setSetup(null);
      setCodice("");
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Codice non valido");
    } finally {
      setBusy(false);
    }
  };

  const disattiva = async () => {
    setBusy(true);
    setErrore("");
    try {
      await api.totpDisable(codice);
      setCodice("");
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Codice non valido");
    } finally {
      setBusy(false);
    }
  };

  if (stato === null) return null;

  // ---------------------------------------------------------- configurazione
  if (setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral-400">
          Inquadra il codice con l'app di autenticazione, poi scrivi qui il numero che mostra.
        </p>

        <div className="flex justify-center rounded-xl bg-white p-4">
          <Qr valore={setup.otpauth_uri} />
        </div>

        <details className="text-sm text-neutral-500">
          <summary className="cursor-pointer">Non riesci a inquadrarlo?</summary>
          <p className="mt-2 text-xs">Inserisci questo codice a mano nell'app:</p>
          <code className="mt-1 block select-all break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-200">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
        </details>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs leading-relaxed text-amber-200/80">
          Usa un'app separata — Aegis, Google Authenticator, quella del telefono. <strong>Non
          salvare questo codice dentro Domus</strong>: servirebbe Domus per entrare in Domus, e al
          primo problema resteresti chiuso fuori.
        </div>

        <div className="space-y-2">
          <label htmlFor="codice-attivazione" className="text-sm font-medium text-neutral-300">
            Codice a 6 cifre
          </label>
          <input
            id="codice-attivazione"
            value={codice}
            onChange={(e) => setCodice(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-center font-mono text-lg tracking-[0.4em] text-neutral-100 outline-none focus:border-indigo-500"
          />
        </div>

        {errore && <Errore>{errore}</Errore>}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setSetup(null); setCodice(""); setErrore(""); }}>
            Annulla
          </Button>
          <Button onClick={attiva} disabled={busy || codice.length !== 6}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Attiva
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- attivo
  if (stato.enabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-200/90">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div>
            Attivo dal{" "}
            {stato.confirmed_at && new Date(stato.confirmed_at).toLocaleDateString("it-IT")}. Ogni
            accesso richiedera' il codice dell'app.
          </div>
        </div>

        <details className="text-sm text-neutral-500">
          <summary className="cursor-pointer">Disattiva</summary>
          <p className="mt-2 text-xs leading-relaxed">
            Serve un codice valido: chi trovasse una sessione aperta non deve poter togliere il
            secondo fattore con un clic.
          </p>
          <input
            value={codice}
            onChange={(e) => setCodice(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-center font-mono tracking-[0.3em] text-neutral-100 outline-none focus:border-indigo-500"
          />
          {errore && <div className="mt-2"><Errore>{errore}</Errore></div>}
          <Button variant="destructive" className="mt-3" onClick={disattiva} disabled={busy || codice.length !== 6}>
            Disattiva il secondo fattore
          </Button>
        </details>
      </div>
    );
  }

  // -------------------------------------------------------------- spento
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-neutral-400">
        Un codice a 6 cifre in aggiunta alla Master Password, a ogni accesso.
      </p>
      <p className="text-xs leading-relaxed text-neutral-600">
        Difende dal caso in cui qualcuno indovini la tua Master Password: senza il codice non puo'
        scaricare il vault. Non difende invece chi ha gia' una copia cifrata — un backup rubato, la
        cache offline di un telefono — perche' li' la decifratura avviene sul dispositivo e il
        server non c'entra.
      </p>
      {errore && <Errore>{errore}</Errore>}
      <Button onClick={avvia} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
        Attiva il secondo fattore
      </Button>
    </div>
  );
}

function Errore({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

/** QR disegnato in locale: il secret non deve passare da un generatore
 *  esterno, e nemmeno da un'immagine remota. */
function Qr({ valore }: { valore: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(valore);
    q.make();
    return q.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  }, [valore]);

  return (
    <div
      className="h-48 w-48 [&>svg]:h-full [&>svg]:w-full"
      aria-label="Codice QR per l'app di autenticazione"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
