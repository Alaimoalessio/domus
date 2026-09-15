import { Loader2, Lock as LockIcon, LogOut } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { SbloccoRapido } from "../components/SbloccoRapido";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { sbloccaConMasterPassword } from "../lib/sblocco";

/**
 * Vault bloccato: la chiave e' uscita dalla RAM, la sessione no. Da qui si
 * riapre con impronta, PIN o master password — quest'ultima senza server,
 * dallo snapshot locale.
 */
export default function Lock() {
  const { locked, session, signIn, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rapido, setRapido] = useState(true);
  const navigate = useNavigate();

  if (session) return <Navigate to="/" replace />;
  if (!locked) return <Navigate to="/login" replace />;

  const conPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      signIn(await sbloccaConMasterPassword(locked.email, password), locked.email);
      navigate("/");
    } catch {
      setError("Master password errata.");
    } finally {
      setBusy(false);
    }
  };

  const esci = async () => {
    await api.logout().catch(() => {});
    signOut();
    navigate("/login");
  };

  return (
    <AuthShell
      title="Vault bloccato"
      description={
        locked.perInattivita
          ? "Bloccato per inattivita': la chiave e' stata cancellata dalla memoria."
          : "La chiave e' stata cancellata dalla memoria."
      }
      footer={
        <button onClick={esci} className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300">
          <LogOut className="h-3.5 w-3.5" /> Esci da {locked.email}
        </button>
      }
    >
      <div className="space-y-5">
        <SbloccoRapido
          autoBiometria
          onDisponibilita={(d) => setRapido(d !== null)}
          onSblocco={(esito, email) => {
            signIn(esito.session, email);
            navigate("/");
          }}
        />
        {rapido && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-800" />
            <span className="text-xs text-neutral-600">oppure</span>
            <div className="h-px flex-1 bg-neutral-800" />
          </div>
        )}
        <form onSubmit={conPassword} className="space-y-4">
          <Field
            id="password"
            label="Master Password"
            type="password"
            required
            autoComplete="current-password"
            autoFocus={!rapido}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Derivazione della chiave...
              </>
            ) : (
              <>
                <LockIcon className="mr-2 h-4 w-4" /> Sblocca
              </>
            )}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
