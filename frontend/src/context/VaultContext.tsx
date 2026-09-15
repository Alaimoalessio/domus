import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "./AuthContext";
import { caricaOffline, syncVault, VAULT_VUOTO, type VaultState } from "../lib/vault";

interface VaultContextType {
  stato: VaultState;
  loading: boolean;
  error: string;
  /** `completo` forza il ricaricamento da zero; altrimenti chiede solo il delta. */
  refresh: (completo?: boolean) => Promise<void>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

/**
 * Il vault decifrato, una volta sola per sessione e condiviso fra le pagine.
 * Prima ogni pagina si sincronizzava e decifrava per conto suo: passare da
 * "Le tue credenziali" a "Codici" mostrava di nuovo "Decifratura del vault…"
 * e teneva due copie dello stesso stato. Si svuota quando la sessione cade:
 * bloccare il vault deve far sparire anche le voci in chiaro dalla RAM.
 */
export function VaultProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [stato, setStato] = useState<VaultState>(VAULT_VUOTO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Il cursore deve restare stabile fra un refresh e l'altro senza rigenerare
  // la callback, altrimenti l'effetto si riattacca a ogni sincronizzazione.
  const statoRef = useRef<VaultState>(VAULT_VUOTO);

  const refresh = useCallback(
    async (completo = false) => {
      if (!session) return;
      try {
        const nuovo = session.offline
          ? await caricaOffline(session)
          : await syncVault(session, completo ? null : statoRef.current);
        statoRef.current = nuovo;
        setStato(nuovo);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sincronizzazione non riuscita");
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    if (!session) {
      // Azzeramento sincrono e voluto: la sessione e' caduta, le voci in
      // chiaro non devono restare in RAM nemmeno per un frame in piu'.
      statoRef.current = VAULT_VUOTO;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStato(VAULT_VUOTO);
      setLoading(true);
      setError("");
      return;
    }
    void refresh(true);
  }, [session, refresh]);

  // Le modifiche fatte su un altro dispositivo arrivano quando la scheda torna
  // in primo piano: un polling continuo terrebbe sveglio il telefono per nulla.
  useEffect(() => {
    if (!session) return;
    // Due segnali distinti: il ritorno alla scheda, e il ritorno alla finestra
    // dopo essere passati a un'altra applicazione. Legare anche il secondo a
    // visibilityState lo renderebbe codice morto, perche' quando la finestra
    // riceve il focus la scheda e' gia' visibile.
    const suFocus = () => void refresh();
    const suVisibilita = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", suVisibilita);
    window.addEventListener("focus", suFocus);
    return () => {
      document.removeEventListener("visibilitychange", suVisibilita);
      window.removeEventListener("focus", suFocus);
    };
  }, [session, refresh]);

  const value = useMemo(() => ({ stato, loading, error, refresh }), [stato, loading, error, refresh]);
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVault(): VaultContextType {
  const c = useContext(VaultContext);
  if (c === undefined) throw new Error("useVault deve stare dentro VaultProvider");
  return c;
}
