import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { RecoveryKit } from "../components/RecoveryKit";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { createRecoveryKit, login, register } from "../lib/vault";

type Phase = "form" | "kit" | "pending";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Le password non corrispondono");
    if (password.length < 12) {
      return setError("La Master Password deve avere almeno 12 caratteri: e' l'unica difesa del vault");
    }

    setError("");
    setStep("Derivazione della chiave (Argon2id, ~1s)...");

    try {
      await register(email, password);

      // Il primo utente e' subito attivo e admin; gli altri restano in attesa
      // che l'admin li approvi, quindi il login fallisce con 403.
      setStep("Accesso...");
      let session;
      try {
        session = await login(email, password);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setPhase("pending");
          return;
        }
        throw err;
      }

      // Il kit richiede una sessione: senza SK non c'e' nulla da wrappare.
      setStep("Creazione del kit di emergenza...");
      const code = await createRecoveryKit(session);
      setRecoveryCode(code);
      signIn(session, email);
      setPhase("kit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante la registrazione");
    } finally {
      setStep("");
    }
  };

  if (phase === "kit") {
    return (
      <RecoveryKit
        code={recoveryCode}
        email={email}
        doneLabel="Ho stampato il codice, apri il vault"
        onDone={() => navigate("/")}
      />
    );
  }

  if (phase === "pending") {
    return (
      <AuthShell
        title="Account in attesa"
        description="Il vault e' stato creato, ma serve l'approvazione dell'amministratore prima del primo accesso."
        footer={<Link to="/login" className="text-indigo-400 hover:text-indigo-300">Vai al login</Link>}
      >
        <p className="text-sm leading-relaxed text-neutral-400">
          Chiedi all'amministratore di approvarti. Al primo accesso ti verra' consegnato il kit di
          emergenza da stampare.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crea il tuo Vault"
      description="La Master Password non viene mai inviata al server e non puo' essere recuperata."
      footer={
        <>
          Hai gia' un account?{" "}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
            Accedi
          </Link>
        </>
      }
    >
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          id="confirm"
          label="Conferma Master Password"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={step !== ""} className="w-full">
          {step ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {step}
            </>
          ) : (
            "Crea Vault"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
