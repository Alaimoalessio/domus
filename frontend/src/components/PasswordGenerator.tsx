import { Check, Copy, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  PASSPHRASE_DEFAULT,
  PASSWORD_DEFAULT,
  entropiaPassphrase,
  entropiaPassword,
  generaPassphrase,
  generaPassword,
  giudizio,
  type OpzioniPassphrase,
  type OpzioniPassword,
} from "../lib/generator";
import { Button } from "./ui/button";

type Modo = "password" | "passphrase";

export function PasswordGenerator({
  onUse,
  onClose,
}: {
  onUse: (valore: string) => void;
  onClose: () => void;
}) {
  const [modo, setModo] = useState<Modo>("password");
  const [opzPw, setOpzPw] = useState<OpzioniPassword>(PASSWORD_DEFAULT);
  const [opzFrase, setOpzFrase] = useState<OpzioniPassphrase>(PASSPHRASE_DEFAULT);
  const [valore, setValore] = useState("");
  const [copiato, setCopiato] = useState(false);

  const rigenera = useCallback(() => {
    setValore(modo === "password" ? generaPassword(opzPw) : generaPassphrase(opzFrase));
  }, [modo, opzPw, opzFrase]);

  useEffect(() => {
    rigenera();
  }, [rigenera]);

  const bit = modo === "password" ? entropiaPassword(opzPw) : entropiaPassphrase(opzFrase);
  const g = giudizio(bit);
  const nessunaClasse =
    modo === "password" && !opzPw.minuscole && !opzPw.maiuscole && !opzPw.cifre && !opzPw.simboli;

  const copia = async () => {
    await navigator.clipboard.writeText(valore);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  };

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-neutral-800 p-0.5">
          {(["password", "passphrase"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                modo === m ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {m === "password" ? "Casuale" : "Frase"}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-neutral-600 transition hover:text-neutral-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="min-h-[3rem] break-all font-mono text-sm leading-relaxed text-neutral-100">
          {nessunaClasse ? (
            <span className="text-amber-400">Seleziona almeno un tipo di carattere.</span>
          ) : (
            valore
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">
            {/* Entropia dello SCHEMA di generazione, non una stima euristica
                sulla stringa: qui lo schema lo conosciamo esattamente. */}
            {bit} bit di entropia
          </span>
          <span className="font-medium text-neutral-400">{g.etichetta}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
          <div className={`h-full rounded-full transition-all ${g.classe}`} style={{ width: `${g.quota}%` }} />
        </div>
      </div>

      {modo === "password" ? (
        <div className="space-y-3">
          <Slider
            etichetta="Lunghezza"
            valore={opzPw.lunghezza}
            min={8}
            max={64}
            onChange={(v) => setOpzPw({ ...opzPw, lunghezza: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Interruttore label="a-z" attivo={opzPw.minuscole} onToggle={() => setOpzPw({ ...opzPw, minuscole: !opzPw.minuscole })} />
            <Interruttore label="A-Z" attivo={opzPw.maiuscole} onToggle={() => setOpzPw({ ...opzPw, maiuscole: !opzPw.maiuscole })} />
            <Interruttore label="0-9" attivo={opzPw.cifre} onToggle={() => setOpzPw({ ...opzPw, cifre: !opzPw.cifre })} />
            <Interruttore label="!#$%" attivo={opzPw.simboli} onToggle={() => setOpzPw({ ...opzPw, simboli: !opzPw.simboli })} />
          </div>
          <Interruttore
            label="Evita caratteri ambigui (0/O, 1/l/I)"
            attivo={opzPw.evitaAmbigui}
            onToggle={() => setOpzPw({ ...opzPw, evitaAmbigui: !opzPw.evitaAmbigui })}
            wide
          />
        </div>
      ) : (
        <div className="space-y-3">
          <Slider
            etichetta="Parole"
            valore={opzFrase.parole}
            min={4}
            max={12}
            onChange={(v) => setOpzFrase({ ...opzFrase, parole: v })}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Separatore</span>
            {["-", ".", "_", " "].map((sep) => (
              <button
                key={sep}
                onClick={() => setOpzFrase({ ...opzFrase, separatore: sep })}
                className={`h-7 w-7 rounded-md border font-mono text-xs transition ${
                  opzFrase.separatore === sep
                    ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                    : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {sep === " " ? "␣" : sep}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Interruttore label="Iniziali maiuscole" attivo={opzFrase.maiuscole} onToggle={() => setOpzFrase({ ...opzFrase, maiuscole: !opzFrase.maiuscole })} />
            <Interruttore label="Aggiungi numero" attivo={opzFrase.numero} onToggle={() => setOpzFrase({ ...opzFrase, numero: !opzFrase.numero })} />
          </div>
          <p className="text-xs text-neutral-600">
            Parole italiane: una passphrase serve quando va digitata a mano, per esempio sul
            telecomando della TV.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={rigenera} className="flex-1">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Rigenera
        </Button>
        <Button variant="outline" size="sm" onClick={copia} disabled={!valore}>
          {copiato ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button size="sm" onClick={() => onUse(valore)} disabled={!valore} className="flex-1">
          Usa questa
        </Button>
      </div>
    </div>
  );
}

function Slider({
  etichetta,
  valore,
  min,
  max,
  onChange,
}: {
  etichetta: string;
  valore: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-400">{etichetta}</span>
        <span className="font-mono font-medium text-neutral-200">{valore}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={valore}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-indigo-500"
      />
    </div>
  );
}

function Interruttore({
  label,
  attivo,
  onToggle,
  wide,
}: {
  label: string;
  attivo: boolean;
  onToggle: () => void;
  wide?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        wide ? "col-span-2" : ""
      } ${
        attivo
          ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
          : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
          attivo ? "border-indigo-500 bg-indigo-500" : "border-neutral-700"
        }`}
      >
        {attivo && <Check className="h-2.5 w-2.5 text-white" />}
      </span>
      {label}
    </button>
  );
}
