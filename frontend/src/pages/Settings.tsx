import {
  ArrowLeft,
  KeyRound,
  Trash2,
  Loader2,
  Printer,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { BiometricPanel } from "../components/BiometricPanel";
import { ExportPanel } from "../components/ExportPanel";
import { ImportPanel } from "../components/ImportPanel";
import { PreferencesPanel } from "../components/PreferencesPanel";
import { SessionsPanel } from "../components/SessionsPanel";
import { TwoFactorPanel } from "../components/TwoFactorPanel";
import { TrashPanel } from "../components/TrashPanel";
import { RecoveryKit } from "../components/RecoveryKit";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api, type MeResponse } from "../lib/api";
import { cancellaSnapshot } from "../lib/offline";
import { changeMasterPassword, createRecoveryKit, dataUltimoSnapshot } from "../lib/vault";

export default function Settings() {
  const { session, email, signOut } = useAuth();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [newKit, setNewKit] = useState("");
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await dataUltimoSnapshot());
      setMe(await api.me());
    } catch {
      /* la pagina resta usabile anche senza il riepilogo */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!session) return null;

  if (newKit) {
    return (
      <RecoveryKit
        code={newKit}
        email={email ?? ""}
        doneLabel="Ho stampato il nuovo codice"
        onDone={() => {
          setNewKit("");
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <Link to="/" className="text-neutral-500 transition hover:text-neutral-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ShieldCheck className="h-5 w-5 text-indigo-400" />
          <span className="font-semibold text-neutral-100">Impostazioni</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Profilo</h2>
          <dl className="space-y-3 text-sm">
            <Row label="Email" value={email ?? "—"} />
            <Row label="Ruolo" value={session.isAdmin ? "Amministratore" : "Utente"} />
            {me && (
              <>
                <Row
                  label="Spazio usato"
                  value={`${format(me.storage_used_bytes)} di ${format(me.storage_quota_bytes)}`}
                />
                <Row label="Voci nel vault" value={`${me.vault_seq} modifiche sincronizzate`} />
              </>
            )}
          </dl>
        </section>

        <ChangePassword
          email={email ?? ""}
          onDone={() => signOut("Password aggiornata, effettua di nuovo l'accesso.")}
        />

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">
            Importa da un altro gestore
          </h2>
          <ImportPanel session={session} onDone={refresh} />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">
            Secondo fattore (2FA)
          </h2>
          <TwoFactorPanel />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Dispositivi collegati</h2>
          <SessionsPanel />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Cestino</h2>
          <TrashPanel session={session} />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Sicurezza del dispositivo</h2>
          <PreferencesPanel />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Sblocco biometrico</h2>
          <BiometricPanel session={session} email={email ?? ""} />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-lg font-semibold text-neutral-100">Copia offline</h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-400">
            {snapshot
              ? `Su questo dispositivo c'e' una copia cifrata del vault, aggiornata al ${new Date(
                  snapshot
                ).toLocaleString("it-IT")}. Serve ad aprirlo in sola lettura quando il server non risponde.`
              : "Nessuna copia locale su questo dispositivo."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-600">
            Contiene solo cio' che il server ha gia': ciphertext e chiavi wrappate, mai la Master
            Password. Chi ruba il dispositivo puo' pero' tentare un attacco a forza bruta senza
            passare dal server — la difesa e' Argon2id piu' la cifratura del disco del telefono.
          </p>
          {snapshot && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                await cancellaSnapshot();
                setSnapshot(null);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Elimina la copia da questo dispositivo
            </Button>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">Esporta il vault</h2>
          <ExportPanel session={session} />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-lg font-semibold text-neutral-100">Kit di emergenza</h2>
          <p className="mt-1 text-sm text-neutral-400">
            {me?.recovery_configured
              ? "Configurato. Il codice stampato resta valido finche' non ne generi uno nuovo — anche dopo un cambio di Master Password."
              : "Non configurato: senza kit, dimenticare la Master Password significa perdere il vault."}
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={async () => setNewKit(await createRecoveryKit(session))}
          >
            <Printer className="mr-2 h-4 w-4" />
            {me?.recovery_configured ? "Genera un nuovo kit" : "Crea il kit"}
          </Button>
          {me?.recovery_configured && (
            <p className="mt-3 text-xs text-neutral-600">
              Generandone uno nuovo, il foglio precedente smette di funzionare.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function ChangePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const { session } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("Le nuove password non corrispondono");
    if (next.length < 12) return setError("La nuova Master Password deve avere almeno 12 caratteri");
    if (next === current) return setError("La nuova password coincide con quella attuale");
    if (!session) return;

    setBusy(true);
    setError("");
    try {
      await changeMasterPassword(session, current, next, email);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cambio password non riuscito");
      setBusy(false); // in caso di successo si smonta: non si tocca lo stato
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="text-lg font-semibold text-neutral-100">Master Password</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Cambia solo il modo in cui la chiave del vault e' protetta: le voci non vengono ricifrate e
        il kit di emergenza resta valido.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <Password
          id="current"
          label="Password attuale"
          autoComplete="current-password"
          value={current}
          disabled={busy}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Password
          id="next"
          label="Nuova Master Password"
          autoComplete="new-password"
          value={next}
          disabled={busy}
          onChange={(e) => setNext(e.target.value)}
        />
        <Password
          id="confirm"
          label="Conferma nuova password"
          autoComplete="new-password"
          value={confirm}
          disabled={busy}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {busy && (
          <div className="space-y-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-3">
            <div className="flex items-center gap-2 text-sm text-indigo-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              Derivazione nuove chiavi in corso...
            </div>
            {/* Argon2id con 64 MiB e 3 iterazioni impiega un paio di secondi:
                senza un segnale continuo sembra che si sia bloccato. */}
            <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-indigo-500" />
            </div>
            <p className="text-xs text-indigo-200/60">
              Due derivazioni Argon2id, una per la password attuale e una per la nuova.
            </p>
          </div>
        )}

        <Button type="submit" disabled={busy || !current || !next || !confirm}>
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Attendere...
            </>
          ) : (
            <>
              <KeyRound className="mr-2 h-4 w-4" /> Cambia password
            </>
          )}
        </Button>
      </form>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="truncate font-medium text-neutral-200">{value}</dd>
    </div>
  );
}

function Password({
  id,
  label,
  ...props
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-neutral-300">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        {...props}
        className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition disabled:opacity-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
      />
    </div>
  );
}


function format(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = value / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
