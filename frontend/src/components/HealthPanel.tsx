import { CheckCircle2, ChevronDown, ShieldAlert, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { analizzaSalute, type Problema } from "../lib/salute";
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

  if (items.length === 0) return null;

  if (problemi.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200/90">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        Nessun problema: nessuna password riutilizzata o debole.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {problemi.map((p) => (
        <Riquadro
          key={p.tipo}
          problema={p}
          aperto={aperto === p.tipo}
          onToggle={() => setAperto(aperto === p.tipo ? null : p.tipo)}
          onApri={onApri}
        />
      ))}
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
