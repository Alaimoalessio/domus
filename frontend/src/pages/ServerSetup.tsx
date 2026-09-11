import { Loader2, Server } from "lucide-react";
import { useState } from "react";

import { AuthShell, ErrorNote, Field } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { leggiServer, normalizzaServer, salvaServer, verificaServer } from "../lib/server";

/**
 * Primo avvio dell'app nativa: a quale server collegarsi. Il frontend e'
 * impacchettato nell'app, quindi qui si sceglie solo dove spedire il
 * ciphertext — non da dove scaricare il codice.
 */
export default function ServerSetup({ onDone }: { onDone: () => void }) {
  const [valore, setValore] = useState(leggiServer() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const esito = normalizzaServer(valore);
    if ("errore" in esito) {
      setError(esito.errore);
      return;
    }
    setBusy(true);
    try {
      await verificaServer(esito.url);
      salvaServer(esito.url);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verifica non riuscita");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Collega il tuo server"
      description="L'indirizzo di Domus sulla tua rete privata. Lo chiedo una volta sola."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="server"
          label="Indirizzo del server"
          type="url"
          required
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://domus.tuo-tailnet.ts.net"
          value={valore}
          onChange={(e) => setValore(e.target.value)}
        />
        <p className="text-xs text-neutral-500">
          Serve https: l'unica eccezione e' localhost, per le prove sulla stessa macchina.
        </p>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifico...
            </>
          ) : (
            <>
              <Server className="mr-2 h-4 w-4" /> Collega
            </>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
