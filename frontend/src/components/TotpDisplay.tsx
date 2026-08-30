import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { InvalidSecret, generateTotp } from "../lib/crypto";

/**
 * Codice a 6 cifre con timer circolare. Il calcolo e' locale: il secret non
 * lascia il dispositivo, esattamente come la password.
 */
export function TotpDisplay({ secret }: { secret: string }) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [period, setPeriod] = useState(30);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await generateTotp(secret);
        if (cancelled) return;
        setCode(next.code);
        setSecondsLeft(next.secondsLeft);
        setPeriod(next.period);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof InvalidSecret ? "Secret non valido" : "Errore nel calcolo");
        setCode("");
      }
    };

    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [secret]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
        {error}
      </div>
    );
  }

  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const progress = secondsLeft / period;
  // Sotto i 5 secondi vale la pena accorgersene prima di iniziare a digitare.
  const urgent = secondsLeft <= 5;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-neutral-800" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className={urgent ? "stroke-red-500" : "stroke-indigo-500"}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
        <text
          x="18"
          y="18"
          textAnchor="middle"
          dominantBaseline="central"
          className={`rotate-90 origin-center text-[10px] font-semibold tabular-nums ${
            urgent ? "fill-red-400" : "fill-neutral-500"
          }`}
        >
          {secondsLeft}
        </text>
      </svg>

      <div className="flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Codice 2FA
        </div>
        <div
          className={`font-mono text-2xl font-bold tabular-nums tracking-[0.2em] transition-colors ${
            urgent ? "text-red-400" : "text-neutral-100"
          }`}
        >
          {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "······"}
        </div>
      </div>

      <button
        onClick={copy}
        disabled={!code}
        className="rounded-lg border border-neutral-800 p-2 text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-100 disabled:opacity-40"
        title="Copia il codice"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
