import { CheckCircle2, Copy, Printer, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "./ui/button";

/**
 * Il foglio da stampare. Il codice mostrato qui e' l'UNICA copia esistente:
 * il server ha solo SK wrappata sotto una chiave derivata da questo codice,
 * e non puo' ricostruirlo.
 */
export function RecoveryKit({
  code,
  email,
  onDone,
  doneLabel,
}: {
  code: string;
  email: string;
  onDone: () => void;
  doneLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 print:bg-white print:block print:p-0">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-2xl print:max-w-none print:border-0 print:bg-white print:shadow-none">
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 print:hidden">
            <ShieldCheck className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-100 print:text-black">
            Kit di Emergenza
          </h1>
          <p className="text-sm leading-relaxed text-neutral-400 print:text-neutral-700">
            Questo codice e' l'<strong>unico modo</strong> per rientrare nel vault di{" "}
            <span className="font-medium text-neutral-200 print:text-black">{email}</span> se
            dimentichi la Master Password. Il server non ne ha copia e non puo' ricostruirlo.
          </p>
        </div>

        <div className="my-8 rounded-xl border border-neutral-800 bg-neutral-950 p-6 text-center print:border-2 print:border-neutral-400 print:bg-white">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500 print:text-neutral-600">
            Codice di recupero
          </div>
          <div className="select-all font-mono text-lg font-bold leading-relaxed tracking-wider text-indigo-400 print:text-xl print:text-black">
            {code}
          </div>
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/80 print:border-neutral-400 print:bg-white print:text-black">
          Stampalo e conservalo offline. Chi ha questo foglio puo' aprire il vault: trattalo come
          le chiavi di casa. Se lo perdi, generane subito uno nuovo dalle impostazioni — il
          vecchio smettera' di funzionare.
        </div>

        <div className="mt-8 space-y-3 print:hidden">
          <div className="flex gap-3">
            <Button variant="outline" onClick={copy} className="flex-1">
              {copied ? (
                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copiato" : "Copia"}
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="flex-1">
              <Printer className="mr-2 h-4 w-4" /> Stampa
            </Button>
          </div>
          <Button onClick={onDone} className="w-full">
            {doneLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
