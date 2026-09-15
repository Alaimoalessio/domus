import { ArrowLeft, Check, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { AggiungiCodice } from "../components/AggiungiCodice";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { copiaSegreto } from "../lib/clipboard";
import { generateTotp } from "../lib/crypto";
import { useVault } from "../context/VaultContext";
import type { DecryptedItem } from "../lib/vault";

interface Codice {
  code: string;
  /** Il codice della finestra successiva: quando mancano pochi secondi e'
   *  quello che conviene copiare, o scade prima di essere incollato. */
  prossimo: string;
  secondsLeft: number;
  period: number;
}

/** Un colore stabile per voce, dal nome: aiuta a trovare a colpo d'occhio
 *  la card giusta in una griglia dove i codici sono tutti uguali fra loro. */
const TINTE = [
  "bg-indigo-500/15 text-indigo-300",
  "bg-emerald-500/15 text-emerald-300",
  "bg-amber-500/15 text-amber-300",
  "bg-rose-500/15 text-rose-300",
  "bg-sky-500/15 text-sky-300",
  "bg-violet-500/15 text-violet-300",
  "bg-teal-500/15 text-teal-300",
  "bg-orange-500/15 text-orange-300",
];
function tinta(nome: string): string {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTE[h % TINTE.length];
}

function Anello({ secondsLeft, period }: { secondsLeft: number; period: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const urgente = secondsLeft <= 5;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3" className="stroke-neutral-800" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - secondsLeft / period)}
        className={urgente ? "stroke-red-500" : "stroke-indigo-500"}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
      <text
        x="20"
        y="20"
        textAnchor="middle"
        dominantBaseline="central"
        className={`origin-center rotate-90 text-[11px] font-semibold tabular-nums ${urgente ? "fill-red-400" : "fill-neutral-500"}`}
      >
        {secondsLeft}
      </text>
    </svg>
  );
}

function Card({ item, codice }: { item: DecryptedItem; codice?: Codice }) {
  const [copiato, setCopiato] = useState(false);
  const urgente = !!codice && codice.secondsLeft <= 5;
  const code = codice?.code ?? "";
  const meta = Math.ceil(code.length / 2);

  const copia = async () => {
    if (!code) return;
    await copiaSegreto(code);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 1500);
  };

  return (
    <button
      onClick={copia}
      disabled={!code}
      title="Tocca per copiare"
      className="group flex w-full items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-left transition hover:border-neutral-700 active:scale-[0.99] disabled:opacity-60"
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${tinta(item.payload.name)}`}
      >
        {item.payload.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-neutral-300">{item.payload.name}</span>
          {item.payload.username && (
            <span className="truncate text-xs text-neutral-600">{item.payload.username}</span>
          )}
        </div>
        <div
          className={`mt-0.5 font-mono text-[28px] font-bold leading-none tabular-nums tracking-[0.15em] transition-colors ${
            copiato ? "text-emerald-400" : urgente ? "text-red-400" : "text-neutral-50"
          }`}
        >
          {code ? `${code.slice(0, meta)} ${code.slice(meta)}` : "··· ···"}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        {copiato ? (
          <div className="flex h-10 w-10 items-center justify-center text-emerald-400">
            <Check className="h-5 w-5" />
          </div>
        ) : codice ? (
          <Anello secondsLeft={codice.secondsLeft} period={codice.period} />
        ) : null}
        {codice && urgente && !copiato && (
          <span className="font-mono text-[11px] tabular-nums text-neutral-500" title="Prossimo codice">
            {codice.prossimo.slice(0, meta)} {codice.prossimo.slice(meta)}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Vista "authenticator": tutte le voci con un secret 2FA, in una griglia di
 * codici che si rinnovano da soli. I secret escono dal payload gia' decifrato
 * in memoria: non c'e' una seconda copia da qualche parte.
 */
export default function Codici() {
  const { session } = useAuth();
  const { stato, loading, error, refresh } = useVault();
  const [query, setQuery] = useState("");
  const [codici, setCodici] = useState<Record<string, Codice>>({});
  const [aggiungi, setAggiungi] = useState(false);
  const campoRicerca = useRef<HTMLInputElement>(null);

  const con2fa = useMemo(
    () =>
      stato.items
        .filter((i) => i.payload.totp)
        .sort((a, b) => {
          const pa = a.payload.preferito ? 0 : 1;
          const pb = b.payload.preferito ? 0 : 1;
          return pa - pb || a.payload.name.localeCompare(b.payload.name, "it");
        }),
    [stato.items]
  );

  // Un solo orologio per tutte le card: N intervalli separati andrebbero fuori
  // fase e farebbero cambiare i codici a scatti diversi.
  //
  // L'ora e' quella del server, non del telefono: un orologio indietro di
  // 40 secondi produrrebbe codici sempre sbagliati senza alcun errore. La
  // deriva la misura il client API sull'header Date di ogni risposta.
  const [deriva, setDeriva] = useState(0);
  useEffect(() => {
    let annullato = false;
    const tick = async () => {
      const at = Date.now() + api.derivaOrologioMs;
      setDeriva(api.derivaOrologioMs);
      const voci = await Promise.all(
        con2fa.map(async (i) => {
          try {
            const ora = await generateTotp(i.payload.totp!, { at });
            const dopo = await generateTotp(i.payload.totp!, { at: at + ora.period * 1000 });
            return [i.id, { ...ora, prossimo: dopo.code }] as const;
          } catch {
            return null;
          }
        })
      );
      if (annullato) return;
      setCodici(Object.fromEntries(voci.filter((v): v is NonNullable<typeof v> => v !== null)));
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      annullato = true;
      window.clearInterval(id);
    };
  }, [con2fa]);

  if (!session) return null;

  const q = query.toLowerCase();
  const visibili = con2fa.filter((i) =>
    `${i.payload.name} ${i.payload.username ?? ""}`.toLowerCase().includes(q)
  );

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link
            to="/"
            title="Torna al vault"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 sm:h-8 sm:w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-400" />
            <span className="font-semibold text-neutral-100">Codici 2FA</span>
          </div>
          <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-auto sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
            <input
              ref={campoRicerca}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca..."
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-9 pr-3 text-base text-neutral-100 outline-none focus:border-indigo-500 sm:h-9 sm:text-sm"
            />
          </div>
          {!session.offline && (
            <Button onClick={() => setAggiungi(true)} className="ml-auto sm:ml-0">
              <Plus className="mr-1 h-4 w-4" /> Aggiungi
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Decifratura del vault...
          </div>
        ) : visibili.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 px-6 py-16 text-center">
            <p className="text-neutral-300">
              {con2fa.length === 0 ? "Nessun codice 2FA ancora." : "Nessun risultato."}
            </p>
            {con2fa.length === 0 && !session.offline && (
              <p className="mt-2 text-sm text-neutral-500">
                Inquadra il QR che il sito mostra quando attivi la verifica in due passaggi, o
                incolla il codice scritto accanto.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibili.map((item) => (
              <Card key={item.id} item={item} codice={codici[item.id]} />
            ))}
          </div>
        )}

        {Math.abs(deriva) > 20_000 && (
          <p className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-center text-xs text-amber-200/90">
            L'orologio di questo dispositivo e' {Math.abs(Math.round(deriva / 1000))} secondi{" "}
            {deriva > 0 ? "indietro" : "avanti"} rispetto al server: i codici qui sono corretti lo
            stesso, ma conviene attivare l'ora automatica nelle impostazioni del sistema.
          </p>
        )}

        {con2fa.length > 0 && (
          <p className="mt-6 text-center text-xs text-neutral-600">
            Tocca un codice per copiarlo. Calcolati su questo dispositivo: i segreti non lasciano mai
            il vault.
          </p>
        )}
      </main>

      {aggiungi && (
        <AggiungiCodice
          session={session}
          items={stato.items}
          onClose={() => setAggiungi(false)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}
