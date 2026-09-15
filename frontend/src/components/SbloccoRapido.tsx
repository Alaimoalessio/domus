import { Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { leggiRecord as leggiRecordWebAuthn, sblocca as sbloccaWebAuthn } from "../lib/biometric";
import {
  leggiRecordNativo,
  leggiRecordPin,
  sbloccaConImprontaNativa,
  sbloccaConPin,
  type EsitoSblocco,
} from "../lib/sblocco";
import { Button } from "./ui/button";

interface Disponibili {
  email: string;
  pin: boolean;
  nativo: boolean;
  webauthn: boolean;
}

/**
 * I modi per riaprire il vault senza master password, nell'ordine in cui
 * conviene proporli: impronta (un gesto), PIN (quattro tocchi). Compare in
 * fondo al login e nella schermata di blocco. Se sul dispositivo non c'e'
 * niente, non rende nulla.
 */
export function SbloccoRapido({
  onSblocco,
  onDisponibilita,
  autoBiometria = false,
}: {
  onSblocco: (esito: EsitoSblocco, email: string) => void;
  onDisponibilita?: (d: Disponibili | null) => void;
  /** Chiede subito l'impronta all'apertura, come fa un authenticator. */
  autoBiometria?: boolean;
}) {
  const [disp, setDisp] = useState<Disponibili | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"pin" | "bio" | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [p, n, w] = await Promise.all([leggiRecordPin(), leggiRecordNativo(), leggiRecordWebAuthn()]);
      const email = p?.email ?? n?.email ?? w?.email;
      const d = email ? { email, pin: !!p, nativo: !!n, webauthn: !!w } : null;
      if (!vivo) return;
      setDisp(d);
      onDisponibilita?.(d);
    })();
    return () => {
      vivo = false;
    };
    // onDisponibilita cambia a ogni render del genitore: si legge solo al montaggio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const biometria = async () => {
    if (!disp) return;
    setBusy("bio");
    setError("");
    try {
      const esito = disp.nativo ? await sbloccaConImprontaNativa() : await sbloccaWebAuthn();
      onSblocco(esito, disp.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sblocco non riuscito");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!autoBiometria || !disp || !(disp.nativo || disp.webauthn)) return;
    // Un tick dopo: il prompt del sensore non deve partire nel bel mezzo del render.
    const t = window.setTimeout(() => void biometria(), 0);
    return () => window.clearTimeout(t);
    // solo al primo caricamento delle disponibilita'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp]);

  const conPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disp || pin.length < 4) return;
    setBusy("pin");
    setError("");
    try {
      onSblocco(await sbloccaConPin(pin), disp.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sblocco non riuscito");
      setPin("");
    } finally {
      setBusy("");
    }
  };

  if (!disp) return null;

  return (
    <div className="space-y-3">
      {(disp.nativo || disp.webauthn) && (
        <Button onClick={biometria} disabled={busy !== ""} className="h-11 w-full">
          {busy === "bio" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Attendo il sensore...
            </>
          ) : (
            <>
              <Fingerprint className="mr-2 h-5 w-5" /> Sblocca con l'impronta
            </>
          )}
        </Button>
      )}
      {disp.pin && (
        <form onSubmit={conPin} className="flex gap-2">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            placeholder="PIN"
            aria-label="PIN"
            autoFocus={!disp.nativo && !disp.webauthn}
            className="h-11 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-center font-mono text-lg tracking-[0.4em] text-neutral-100 outline-none focus:border-indigo-500"
          />
          <Button type="submit" disabled={busy !== "" || pin.length < 4} className="h-11">
            {busy === "pin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="text-center text-xs text-neutral-500">{disp.email}</div>
    </div>
  );
}
