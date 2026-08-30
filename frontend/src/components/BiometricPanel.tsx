import { Fingerprint, Loader2, ShieldCheck, TriangleAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import {
  abilita,
  disabilita,
  leggiRecord,
  verificaSupporto,
  type RecordBiometrico,
  type Supporto,
} from "../lib/biometric";
import type { Session } from "../lib/vault";
import { Button } from "./ui/button";

export function BiometricPanel({ session, email }: { session: Session; email: string }) {
  const [supporto, setSupporto] = useState<Supporto | null>(null);
  const [record, setRecord] = useState<RecordBiometrico | null>(null);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState("");

  const ricarica = useCallback(async () => {
    setSupporto(await verificaSupporto());
    setRecord(await leggiRecord());
  }, []);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  const attiva = async () => {
    setBusy(true);
    setErrore("");
    try {
      if (!api.refreshToken) throw new Error("Sessione non valida: rientra e riprova.");
      await abilita(session, email, api.refreshToken);
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Attivazione non riuscita");
    } finally {
      setBusy(false);
    }
  };

  const rimuovi = async () => {
    await disabilita();
    await ricarica();
  };

  if (supporto === null) return null;

  // Degradazione graziosa: senza PRF il pulsante non compare affatto. Nessun
  // ripiego su PIN: un PIN a sei cifre e' una ventina di bit, e chi ha il
  // dispositivo salterebbe WebAuthn del tutto per forzarlo offline. Sarebbe un
  // declassamento venduto come funzione di sicurezza.
  if (!supporto.disponibile) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm text-neutral-500">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          {supporto.motivo}
          <div className="mt-1 text-xs text-neutral-600">
            Serve un dispositivo con FaceID, TouchID o impronta e il supporto all'estensione
            WebAuthn PRF (iOS 18+, Android recenti, Chrome/Safari aggiornati).
          </div>
        </div>
      </div>
    );
  }

  if (record) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-200/90">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div>
            Attivo su questo dispositivo dal{" "}
            {new Date(record.creato).toLocaleDateString("it-IT")}.
            <div className="mt-1 text-xs text-emerald-200/60">
              La chiave che apre il pacchetto viene rigenerata dal sensore a ogni sblocco e non e'
              mai salvata. A riposo resta solo il pacchetto cifrato.
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={rimuovi}>
          <Trash2 className="mr-2 h-4 w-4" /> Disattiva su questo dispositivo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-neutral-400">
        Apri Domus con FaceID, TouchID o l'impronta invece di digitare la Master Password. La
        password non viene salvata da nessuna parte: viene conservata la sola chiave del vault,
        cifrata con materiale che il sensore rigenera a ogni sblocco.
      </p>
      {errore && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {errore}
        </div>
      )}
      <Button onClick={attiva} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registrazione del dispositivo...
          </>
        ) : (
          <>
            <Fingerprint className="mr-2 h-4 w-4" /> Abilita lo sblocco biometrico
          </>
        )}
      </Button>
      <p className="text-xs text-neutral-600">
        Vale solo su questo dispositivo e su questo browser. Su un altro telefono va abilitato di
        nuovo.
      </p>
    </div>
  );
}
