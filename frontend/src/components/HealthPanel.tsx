import { CheckCircle2, ChevronDown, Globe, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { ControlloNonRiuscito, controllaTutte, type EsitoCompromissione } from "../lib/compromesse";
import { analizzaSalute, type Problema } from "../lib/salute";
import { Button } from "./ui/button";
import type { DecryptedItem } from "../lib/vault";

export function HealthPanel({
  items,
  onApri,
}: {
  items: DecryptedItem[];
  onApri: (item: DecryptedItem) => void;
}) {
  const problemi = useMemo(() => analizzaSalute(items), [items]);
  const [aperto, setAperto] = useState<string | null>(null);
  const [compromesse, setCompromesse] = useState<EsitoCompromissione[] | null>(null);
  const [inCorso, setInCorso] = useState<{ fatte: number; totali: number } | null>(null);
  const [erroreRete, setErroreRete] = useState("");

  const controllaViolazioni = async () => {
    setErroreRete("");
    setInCorso({ fatte: 0, totali: 0 });
    try {
      setCompromesse(await controllaTutte(items, (fatte, totali) => setInCorso({ fatte, totali })));
    } catch (err) {
      setErroreRete(
        err instanceof ControlloNonRiuscito ? err.message : "Controllo non riuscito"
      );
      setCompromesse(null);
    } finally {
      setInCorso(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {problemi.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200/90">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          Nessuna password riutilizzata o debole.
        </div>
      ) : (
        problemi.map((p) => (
          <Riquadro
            key={p.tipo}
            problema={p}
            aperto={aperto === p.tipo}
            onToggle={() => setAperto(aperto === p.tipo ? null : p.tipo)}
            onApri={onApri}
          />
        ))
      )}

      {/* Il controllo sulle violazioni sta a parte e parte solo su richiesta:
          e' l'unica funzione di Domus che apre una connessione verso internet. */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
        {compromesse === null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <Globe className="h-4 w-4 text-neutral-500" />
              Password comparse in violazioni note
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              Interroga Have I Been Pwned. Vengono inviati solo i primi cinque caratteri
              dell'hash: la password non lascia il dispositivo. E' l'unica funzione di Domus che
              si collega a internet, quindi parte solo se lo chiedi tu.
            </p>
            {erroreRete && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                {erroreRete}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={controllaViolazioni} disabled={inCorso !== null}>
              {inCorso ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {inCorso.totali ? `${inCorso.fatte} di ${inCorso.totali}` : "Avvio..."}
                </>
              ) : (
                "Controlla ora"
              )}
            </Button>
          </div>
        ) : compromesse.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-200/90">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            Nessuna delle tue password compare nelle violazioni note.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-red-200">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
              {compromesse.length}{" "}
              {compromesse.length === 1 ? "password compromessa" : "password compromesse"}
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              Compaiono in violazioni gia' pubbliche: vanno cambiate, a prescindere da quanto
              sembrino robuste.
            </p>
            {compromesse.map(({ item, occorrenze }) => (
              <button
                key={item.id}
                onClick={() => onApri(item)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-300 transition hover:bg-neutral-800/60"
              >
                <span className="min-w-0 flex-1 truncate">{item.payload.name}</span>
                <span className="shrink-0 text-xs text-red-300">
                  {occorrenze.toLocaleString("it-IT")} volte
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Riquadro({
  problema,
  aperto,
  onToggle,
  onApri,
}: {
  problema: Problema;
  aperto: boolean;
  onToggle: () => void;
  onApri: (item: DecryptedItem) => void;
}) {
  const alta = problema.gravita === "alta";
  const stile = alta
    ? "border-red-500/25 bg-red-500/5"
    : "border-amber-500/25 bg-amber-500/5";
  const testo = alta ? "text-red-200" : "text-amber-200";

  return (
    <div className={`rounded-xl border ${stile}`}>
      <button
        onClick={onToggle}
        aria-expanded={aperto}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {alta ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
        ) : (
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium ${testo}`}>{problema.titolo}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">
            {problema.dettaglio}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-neutral-600 transition-transform ${aperto ? "rotate-180" : ""}`}
        />
      </button>

      {aperto && (
        <div className="space-y-1 border-t border-neutral-800/60 px-4 py-3">
          {problema.voci.map((v) => (
            <button
              key={v.id}
              onClick={() => onApri(v)}
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-neutral-300 transition hover:bg-neutral-800/60"
            >
              {v.payload.name}
              {v.payload.username && (
                <span className="text-neutral-600"> · {v.payload.username}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
