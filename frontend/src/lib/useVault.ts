import { useCallback, useEffect, useRef, useState } from "react";

import { caricaOffline, syncVault, VAULT_VUOTO, type Session, type VaultState } from "./vault";

/**
 * Carica il vault (delta o completo) e lo tiene aggiornato quando la scheda
 * torna in primo piano. Stessa logica della pagina principale, condivisa con
 * le viste secondarie che hanno bisogno delle voci decifrate.
 */
export function useVault(session: Session | null) {
  const [stato, setStato] = useState<VaultState>(VAULT_VUOTO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
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
  }, [refresh]);

  return { stato, loading, error, refresh };
}
