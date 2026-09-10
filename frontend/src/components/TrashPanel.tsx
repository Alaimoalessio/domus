import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { caricaCestino, restoreItem, type Session, type VoceCestinata } from "../lib/vault";
import { Button } from "./ui/button";

const GIORNI_DI_GRAZIA = 7;

export function TrashPanel({ session, onRestored }: { session: Session; onRestored?: () => void }) {
  const [voci, setVoci] = useState<VoceCestinata[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState("");
  const [errore, setErrore] = useState("");

  const ricarica = useCallback(async () => {
    try {
      setVoci(await caricaCestino(session));
      setErrore("");
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Caricamento non riuscito");
    } finally {
      setCaricamento(false);
    }
  }, [session]);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  const ripristina = async (v: VoceCestinata) => {
    setInCorso(v.id);
    setErrore("");
    try {
      await restoreItem(v.id);
      await ricarica();
      onRestored?.();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Ripristino non riuscito");
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
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-neutral-400">
        Le voci cancellate restano recuperabili per {GIORNI_DI_GRAZIA} giorni, poi vengono
        eliminate davvero. Anche nel cestino restano cifrate: il server non le legge piu' di prima.
      </p>

      {errore && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errore}
        </div>
      )}

      {voci.length === 0 ? (
        <p className="text-sm text-neutral-600">Il cestino e' vuoto.</p>
      ) : (
        <div className="space-y-2">
          {voci.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3"
            >
              <Trash2 className="h-4 w-4 shrink-0 text-neutral-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-200">
                  {v.payload.name || "Senza nome"}
                </div>
                <div className="text-xs text-neutral-600">
                  {giorniRimasti(v.deletedAt)}
                  {v.attachments > 0 &&
                    ` · ${v.attachments} ${v.attachments === 1 ? "allegato" : "allegati"}`}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={inCorso !== ""}
                onClick={() => ripristina(v)}
              >
                {inCorso === v.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Ripristina
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Meglio "restano 5 giorni" che una data: quello che serve sapere e' quanto
 *  tempo resta per cambiare idea. */
function giorniRimasti(deletedAt: string): string {
  const scadenza = new Date(deletedAt).getTime() + GIORNI_DI_GRAZIA * 86_400_000;
  const ore = Math.max(0, Math.round((scadenza - Date.now()) / 3_600_000));
  if (ore <= 1) return "eliminata definitivamente a momenti";
  if (ore < 48) return `restano ${ore} ore`;
  return `restano ${Math.floor(ore / 24)} giorni`;
}
