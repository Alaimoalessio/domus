import { Check, Copy, Eye, EyeOff, Plus, X } from "lucide-react";
import { useState } from "react";

import type { CampoPersonalizzato } from "../lib/vault";
import { Button } from "./ui/button";

/** Campi liberi: domande di sicurezza, numeri cliente, PIN secondari — tutto
 *  cio' che non entra nei campi fissi ma che finiresti a scrivere nelle note,
 *  dove non si puo' ne' nascondere ne' copiare con un tocco. */
export function CustomFields({
  campi,
  readOnly,
  onChange,
}: {
  campi: CampoPersonalizzato[];
  readOnly: boolean;
  onChange: (campi: CampoPersonalizzato[]) => void;
}) {
  const aggiorna = (i: number, patch: Partial<CampoPersonalizzato>) =>
    onChange(campi.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-300">Campi personalizzati</label>
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([...campi, { nome: "", valore: "", nascosto: false }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Aggiungi
          </Button>
        )}
      </div>

      {campi.length === 0 ? (
        <p className="text-xs text-neutral-600">
          Domande di sicurezza, numeri cliente, un secondo PIN.
        </p>
      ) : (
        campi.map((c, i) => (
          <Riga
            key={i}
            campo={c}
            readOnly={readOnly}
            onChange={(patch) => aggiorna(i, patch)}
            onRimuovi={() => onChange(campi.filter((_, idx) => idx !== i))}
          />
        ))
      )}
    </div>
  );
}

function Riga({
  campo,
  readOnly,
  onChange,
  onRimuovi,
}: {
  campo: CampoPersonalizzato;
  readOnly: boolean;
  onChange: (patch: Partial<CampoPersonalizzato>) => void;
  onRimuovi: () => void;
}) {
  const [mostrato, setMostrato] = useState(false);
  const [copiato, setCopiato] = useState(false);

  const copia = async () => {
    await navigator.clipboard.writeText(campo.valore);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  };

  const classe =
    "h-9 w-full min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500";

  return (
    <div className="flex items-center gap-2">
      <input
        value={campo.nome}
        onChange={(e) => onChange({ nome: e.target.value })}
        readOnly={readOnly}
        placeholder="Nome"
        className={`${classe} basis-1/3`}
      />
      <input
        type={campo.nascosto && !mostrato ? "password" : "text"}
        value={campo.valore}
        onChange={(e) => onChange({ valore: e.target.value })}
        readOnly={readOnly}
        placeholder="Valore"
        className={`${classe} flex-1 ${campo.nascosto ? "font-mono" : ""}`}
      />
      <button
        onClick={() => (campo.nascosto ? setMostrato((v) => !v) : onChange({ nascosto: true }))}
        title={campo.nascosto ? (mostrato ? "Nascondi" : "Mostra") : "Tratta come segreto"}
        className="shrink-0 text-neutral-600 transition hover:text-neutral-300"
      >
        {campo.nascosto && !mostrato ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <button
        onClick={copia}
        title="Copia"
        className="shrink-0 text-neutral-600 transition hover:text-neutral-300"
      >
        {copiato ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
      {!readOnly && (
        <button
          onClick={onRimuovi}
          title="Rimuovi"
          className="shrink-0 text-neutral-600 transition hover:text-red-400"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
