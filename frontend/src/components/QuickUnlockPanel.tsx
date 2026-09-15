import { Fingerprint, KeyRound, Loader2, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  abilitaImprontaNativa,
  abilitaPin,
  disabilitaImprontaNativa,
  disabilitaPin,
  improntaNativaDisponibile,
  leggiRecordNativo,
  leggiRecordPin,
  pinValido,
  type RecordNativo,
  type RecordPin,
} from "../lib/sblocco";
import { eAppNativa } from "../lib/server";
import type { Session } from "../lib/vault";
import { Button } from "./ui/button";

const CAMPO =
  "h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-center font-mono text-lg tracking-[0.4em] text-neutral-100 outline-none transition focus:border-indigo-500";

function Attivo({ dal, testo }: { dal: string; testo: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-200/90">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      <div>
        Attivo dal {new Date(dal).toLocaleDateString("it-IT")}.
        <div className="mt-1 text-xs text-emerald-200/60">{testo}</div>
      </div>
    </div>
  );
}

/** PIN e, nell'app installata, impronta: i due modi di riaprire il vault
 *  senza master password su questo dispositivo. */
export function QuickUnlockPanel({ session, email }: { session: Session; email: string }) {
  const [pin, setPin] = useState<RecordPin | null>(null);
  const [nativo, setNativo] = useState<RecordNativo | null>(null);
  const [supportoNativo, setSupportoNativo] = useState<{ disponibile: boolean; motivo?: string } | null>(null);
  const [nuovo, setNuovo] = useState("");
  const [conferma, setConferma] = useState("");
  const [busy, setBusy] = useState<"pin" | "bio" | "">("");
  const [errore, setErrore] = useState("");

  const ricarica = useCallback(async () => {
    setPin(await leggiRecordPin());
    setNativo(await leggiRecordNativo());
    setSupportoNativo(eAppNativa() ? await improntaNativaDisponibile() : null);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void ricarica(), 0);
    return () => window.clearTimeout(t);
  }, [ricarica]);

  const attivaPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore("");
    if (nuovo !== conferma) {
      setErrore("I due PIN non coincidono.");
      return;
    }
    setBusy("pin");
    try {
      await abilitaPin(session, email, nuovo);
      setNuovo("");
      setConferma("");
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Attivazione non riuscita");
    } finally {
      setBusy("");
    }
  };

  const attivaNativo = async () => {
    setErrore("");
    setBusy("bio");
    try {
      await abilitaImprontaNativa(session, email);
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Attivazione non riuscita");
    } finally {
      setBusy("");
    }
  };

  const avvisoPin = nuovo ? pinValido(nuovo) : null;

  return (
    <div className="space-y-6">
      {/* ---- impronta nativa: solo nell'app installata */}
      {supportoNativo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Fingerprint className="h-4 w-4 text-indigo-400" /> Impronta
          </div>
          {nativo ? (
            <>
              <Attivo
                dal={nativo.creato}
                testo="La chiave che apre il pacchetto sta nel Keystore del telefono e ogni lettura richiede il sensore. Registrare una nuova impronta la invalida."
              />
              <Button
                variant="outline"
                onClick={async () => {
                  await disabilitaImprontaNativa();
                  await ricarica();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Disattiva l'impronta
              </Button>
            </>
          ) : supportoNativo.disponibile ? (
            <Button onClick={attivaNativo} disabled={busy !== ""}>
              {busy === "bio" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-4 w-4" />}
              Abilita l'impronta
            </Button>
          ) : (
            <p className="text-sm text-neutral-500">{supportoNativo.motivo}</p>
          )}
        </div>
      )}

      {/* ---- PIN */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <KeyRound className="h-4 w-4 text-indigo-400" /> PIN
        </div>
        {pin ? (
          <>
            <Attivo
              dal={pin.creato}
              testo="Il PIN da solo non apre nulla: serve anche un segreto che sta sul server e viene consegnato solo dopo il PIN giusto. Cinque errori e il PIN si disattiva da solo. Senza rete, usa la master password."
            />
            <Button
              variant="outline"
              onClick={async () => {
                await disabilitaPin();
                await ricarica();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Disattiva il PIN
            </Button>
          </>
        ) : (
          <form onSubmit={attivaPin} className="space-y-3">
            <p className="text-sm leading-relaxed text-neutral-400">
              Riapri il vault con 4–8 cifre invece della Master Password. Un ladro con il telefono
              non puo' provare i PIN a freddo: la verifica passa dal server, che concede cinque
              tentativi.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={nuovo}
                onChange={(e) => setNuovo(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                placeholder="Nuovo PIN"
                aria-label="Nuovo PIN"
                className={CAMPO}
              />
              <input
                value={conferma}
                onChange={(e) => setConferma(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                placeholder="Ripeti il PIN"
                aria-label="Ripeti il PIN"
                className={CAMPO}
              />
            </div>
            {avvisoPin && <p className="text-xs text-amber-300">{avvisoPin}</p>}
            <Button type="submit" disabled={busy !== "" || !!avvisoPin || nuovo.length < 4}>
              {busy === "pin" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Abilita il PIN
            </Button>
          </form>
        )}
      </div>

      {errore && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {errore}
        </div>
      )}
      <p className="text-xs text-neutral-600">
        Valgono solo su questo dispositivo. Uscire con "Esci" li rimuove; "Blocca" no.
      </p>
    </div>
  );
}
