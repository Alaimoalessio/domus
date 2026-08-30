import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { login } from "../lib/vault";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const { signIn, lockedOut, dismissLock } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    dismissLock();
    try {
      signIn(await login(email, password), email);
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
      {lockedOut && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Vault bloccato per inattivita'. La chiave e' stata cancellata dalla memoria.
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
