import { Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { InvalidSecret, parametriTotp } from "../lib/crypto";
import { useModaleTastiera } from "../lib/useModaleTastiera";
import { createItem, updateItem, type DecryptedItem, type Session } from "../lib/vault";
import { ScannerQr } from "./ScannerQr";
import { TotpDisplay } from "./TotpDisplay";
import { Button } from "./ui/button";

/**
 * Aggiunta di un codice 2FA come in un'app authenticator: QR o codice, e
 * via. Il secret finisce in una voce del vault — nuova, con il nome preso
 * dal QR, oppure una gia' esistente che ancora non ha il 2FA.
 */
export function AggiungiCodice({
  session,
  items,
  onClose,
  onSaved,
}: {
  session: Session;
  items: DecryptedItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grezzo, setGrezzo] = useState("");
  const [nome, setNome] = useState("");
  const [account, setAccount] = useState("");
  const [destinazione, setDestinazione] = useState<string>("nuova");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contenitore = useModaleTastiera(onClose);

  const senza2fa = useMemo(
    () => items.filter((i) => !i.payload.totp).sort((a, b) => a.payload.name.localeCompare(b.payload.name, "it")),
    [items]
  );

  const parametri = useMemo(() => {
    if (!grezzo.trim()) return null;
    try {
      const p = parametriTotp(grezzo);
      return p.secret ? p : null;
    } catch (err) {
      return err instanceof InvalidSecret ? err : null;
    }
  }, [grezzo]);
  const valido = parametri !== null && !(parametri instanceof InvalidSecret);

  const letto = (valore: string) => {
    setGrezzo(valore);
    try {
      const p = parametriTotp(valore);
      if (p.issuer && !nome) setNome(p.issuer);
      if (p.account && !account) setAccount(p.account);
    } catch {
      // resta il testo grezzo: l'errore lo mostra l'anteprima
    }
  };

  const salva = async () => {
    if (!valido) return;
    setBusy(true);
    setError("");
    try {
      if (destinazione === "nuova") {
        if (!nome.trim()) {
          setError("Serve un nome per la voce.");
          return;
        }
        await createItem(session, "login", {
          name: nome.trim(),
          username: account.trim() || undefined,
          totp: grezzo.trim(),
        });
      } else {
        const item = items.find((i) => i.id === destinazione);
        if (!item) throw new Error("Voce non trovata");
        await updateItem(session, item, { ...item.payload, totp: grezzo.trim() });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setBusy(false);
    }
  };

  const classeCampo =
    "h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contenitore}
        role="dialog"
        aria-modal="true"
        aria-label="Aggiungi un codice 2FA"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-100">Aggiungi un codice</h2>
          <button onClick={onClose} className="text-neutral-500 transition hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <ScannerQr onLetto={letto} />

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-300">Oppure incolla il codice</label>
            <input
              value={grezzo}
              onChange={(e) => letto(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              placeholder="JBSWY3DPEHPK3PXP oppure otpauth://..."
              className={`${classeCampo} font-mono placeholder:font-sans`}
            />
          </div>

          {parametri instanceof InvalidSecret ? (
            <p className="text-xs text-amber-300">{parametri.message}</p>
          ) : (
            valido && <TotpDisplay secret={grezzo} />
          )}

          {valido && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-300">Dove salvarlo</label>
                <select
                  value={destinazione}
                  onChange={(e) => setDestinazione(e.target.value)}
                  className={classeCampo}
                >
                  <option value="nuova">Nuova voce</option>
                  {senza2fa.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.payload.name}
                      {i.payload.username ? ` — ${i.payload.username}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {destinazione === "nuova" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-neutral-300">Sito o servizio</label>
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Instagram"
                      className={classeCampo}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-neutral-300">
                      Account <span className="text-neutral-600">(opzionale)</span>
                    </label>
                    <input
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="nome@esempio.it"
                      autoCapitalize="none"
                      className={classeCampo}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Annulla
            </Button>
            <Button onClick={salva} disabled={!valido || busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salva
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
