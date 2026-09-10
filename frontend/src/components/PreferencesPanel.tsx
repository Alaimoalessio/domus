import { Clipboard, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SCELTE_BLOCCO,
  SCELTE_CLIPBOARD,
  etichettaBlocco,
  etichettaClipboard,
  leggiPreferenze,
  salvaPreferenze,
  type Preferenze,
} from "../lib/preferenze";

export function PreferencesPanel() {
  const [p, setP] = useState<Preferenze>(leggiPreferenze);

  useEffect(() => {
    salvaPreferenze(p);
  }, [p]);

  return (
    <div className="space-y-6">
      <Gruppo
        icona={<Lock className="h-4 w-4" />}
        titolo="Blocco automatico"
        descrizione="Dopo questo tempo di inattivita' la chiave viene cancellata dalla memoria e serve di nuovo la Master Password."
        scelte={SCELTE_BLOCCO}
        valore={p.minutiBlocco}
        etichetta={etichettaBlocco}
        onChange={(v) => setP({ ...p, minutiBlocco: v })}
      />

      <Gruppo
        icona={<Clipboard className="h-4 w-4" />}
        titolo="Svuota la clipboard"
        descrizione="Dopo una copia, la password viene tolta dagli appunti: qualunque altra applicazione puo' leggerli."
        scelte={SCELTE_CLIPBOARD}
        valore={p.secondiClipboard}
        etichetta={etichettaClipboard}
        onChange={(v) => setP({ ...p, secondiClipboard: v })}
      />

      <p className="text-xs leading-relaxed text-neutral-600">
        Queste scelte valgono solo su questo dispositivo e non vengono sincronizzate: il portatile
        di casa e il telefono che porti in giro meritano tempi diversi.
      </p>
    </div>
  );
}

function Gruppo<T extends number>({
  icona,
  titolo,
  descrizione,
  scelte,
  valore,
  etichetta,
  onChange,
}: {
  icona: React.ReactNode;
  titolo: string;
  descrizione: string;
  scelte: readonly T[];
  valore: number;
  etichetta: (v: number) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
        {icona}
        {titolo}
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">{descrizione}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {scelte.map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              valore === s
                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {etichetta(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
