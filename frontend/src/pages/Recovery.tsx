import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { recover } from "../lib/vault";

export default function Recovery() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Le password non corrispondono");
    if (password.length < 12) return setError("La nuova Master Password deve avere almeno 12 caratteri");

    setBusy(true);
    setError("");
    try {
      // Il codice non raggiunge mai il server: ne parte solo una sottochiave
      // derivata, che prova l'identita' senza rivelarlo.
      signIn(await recover(email, code, password), email);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recupero non riuscito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Recupero del Vault"
      description="Inserisci il codice del kit di emergenza che hai stampato."
      footer={
        <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
          Torna al login
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="email"
          label="Email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="space-y-2">
          <label htmlFor="code" className="text-sm font-medium text-neutral-300">
            Codice di recupero
          </label>
          <textarea
            id="code"
            required
            rows={3}
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm uppercase tracking-wider text-neutral-100 outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
          <p className="text-xs text-neutral-500">
            Trattini e maiuscole non contano: puoi ricopiarlo come ti viene.
          </p>
        </div>
        <Field
          id="password"
          label="Nuova Master Password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          id="confirm"
          label="Conferma"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recupero della chiave...
            </>
          ) : (
            <>
              <KeyRound className="mr-2 h-4 w-4" /> Recupera il Vault
            </>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
