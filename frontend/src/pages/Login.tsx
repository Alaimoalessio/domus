import { CheckCircle2, CloudOff, Fingerprint, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { leggiRecord, sblocca, type RecordBiometrico } from "../lib/biometric";
import { eProblemaDiRete } from "../lib/offline";
import { login, loginOffline } from "../lib/vault";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [biometria, setBiometria] = useState<RecordBiometrico | null>(null);
  const [sbloccando, setSbloccando] = useState(false);

  useEffect(() => {
    void leggiRecord().then(setBiometria);
  }, []);

  const sbloccaBiometrico = async () => {
    if (!biometria) return;
    setSbloccando(true);
    setError("");
    setOffline(false);
    try {
      const esito = await sblocca();
      if (!esito.online) setOffline(true);
      signIn(esito.session, biometria.email);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sblocco non riuscito");
    } finally {
      setSbloccando(false);
    }
  };

  const navigate = useNavigate();
  const { signIn, lockedOut, dismissLock, notice, clearNotice } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    dismissLock();
    clearNotice();
    try {
      let sessione;
      try {
        sessione = await login(email, password);
      } catch (err) {
        // Solo un guasto di RETE fa ripiegare sulla copia locale. Un 401 no:
        // le credenziali sono sbagliate, e aprire comunque il vault dalla
        // cache sarebbe il modo piu' rapido di annullare l'autenticazione.
        if (!eProblemaDiRete(err)) throw err;
        setOffline(true);
        sessione = await loginOffline(email, password);
      }
      signIn(sessione, email);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accesso non riuscito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Bentornato"
      description="La derivazione della chiave avviene sul tuo dispositivo."
      footer={
        <div className="space-y-2">
          <div>
            Non hai un account?{" "}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
              Registrati
            </Link>
          </div>
          <div>
            <Link to="/recovery" className="text-neutral-500 hover:text-neutral-300">
              Ho dimenticato la Master Password
            </Link>
          </div>
        </div>
      }
    >
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}
      {offline && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          Server non raggiungibile: sto aprendo la copia locale, in sola lettura.
        </div>
      )}
      {lockedOut && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Vault bloccato per inattivita'. La chiave e' stata cancellata dalla memoria.
        </div>
      )}
      {biometria && (
        <div className="mb-6 space-y-3">
          <Button onClick={sbloccaBiometrico} disabled={sbloccando} className="h-11 w-full">
            {sbloccando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Attendo il sensore...
              </>
            ) : (
              <>
                <Fingerprint className="mr-2 h-5 w-5" /> Sblocca con la biometria
              </>
            )}
          </Button>
          <div className="text-center text-xs text-neutral-500">{biometria.email}</div>
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-neutral-800" />
            <span className="text-xs text-neutral-600">oppure</span>
            <div className="h-px flex-1 bg-neutral-800" />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="email"
          label="Email"
          type="email"
          required
          autoComplete="username"
          placeholder="mario@casa.local"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="password"
          label="Master Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Derivazione della chiave...
            </>
          ) : (
            "Sblocca il Vault"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
