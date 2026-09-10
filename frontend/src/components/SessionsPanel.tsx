import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api, type SessionOut } from "../lib/api";
import { Button } from "./ui/button";

/** Ogni accesso salva un'etichetta del dispositivo: qui si vedono le sessioni
 *  ancora valide e si chiudono a distanza. E' il modo con cui ci si accorge di
 *  un accesso che non si riconosce. */
export function SessionsPanel() {
  const [sessioni, setSessioni] = useState<SessionOut[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState("");
  const [errore, setErrore] = useState("");

  const ricarica = useCallback(async () => {
    try {
      setSessioni(await api.sessions());
      setErrore("");
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Caricamento non riuscito");
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  const revoca = async (s: SessionOut) => {
    setInCorso(s.id);
    setErrore("");
    try {
      await api.revokeSession(s.id);
      await ricarica();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Revoca non riuscita");
    } finally {
      setInCorso("");
    }
  };

  if (caricamento) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errore && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errore}
        </div>
      )}

      {sessioni.map((s) => {
        const mobile = /android|iphone|samsung|mobile|telefono/i.test(s.device_label);
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3"
          >
            {mobile ? (
              <Smartphone className="h-4 w-4 shrink-0 text-neutral-500" />
            ) : (
              <Laptop className="h-4 w-4 shrink-0 text-neutral-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-neutral-200">
                  {s.device_label}
                </span>
                {s.current && (
                  <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                    questo
                  </span>
                )}
              </div>
              <div className="text-xs text-neutral-600">
                dal {new Date(s.created_at).toLocaleDateString("it-IT")} · scade il{" "}
                {new Date(s.expires_at).toLocaleDateString("it-IT")}
              </div>
            </div>
            {/* La sessione corrente non si revoca da qui: per uscire c'e' il
                pulsante di logout, e confonderli e' un modo per buttarsi fuori
                credendo di chiudere un altro dispositivo. */}
            {!s.current && (
              <Button
                variant="ghost"
                size="sm"
                disabled={inCorso !== ""}
                onClick={() => revoca(s)}
              >
                {inCorso === s.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <LogOut className="mr-1.5 h-3.5 w-3.5" /> Disconnetti
                  </>
                )}
              </Button>
            )}
          </div>
        );
      })}

      <p className="text-xs leading-relaxed text-neutral-600">
        Disconnettere un dispositivo ne invalida la sessione: dovra' rientrare con la Master
        Password. Se non riconosci un accesso, cambia anche la Master Password.
      </p>
    </div>
  );
}
