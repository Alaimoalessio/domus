import { Loader2, LogOut, Plus, Printer, Search, Settings, ShieldCheck, Trash2, TriangleAlert, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ItemModal } from "../components/ItemModal";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { deleteItem, syncVault, VAULT_VUOTO, type DecryptedItem, type VaultState } from "../lib/vault";

export default function Vault() {
  const { session, signOut } = useAuth();
  const [stato, setStato] = useState<VaultState>(VAULT_VUOTO);
  const items = stato.items;
  const files = stato.files;
  const unreadable = stato.unreadable;
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsKit, setNeedsKit] = useState(false);
  // Il cursore deve restare stabile fra un refresh e l'altro senza rigenerare
  // la callback, altrimenti l'effetto si riattacca a ogni sincronizzazione.
  const statoRef = useRef<VaultState>(VAULT_VUOTO);
  const [editing, setEditing] = useState<DecryptedItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  /** `completo` forza il ricaricamento da zero; altrimenti chiede solo il delta. */
  const refresh = useCallback(
    async (completo = false) => {
      if (!session) return;
      try {
        const aggiornato = await syncVault(session, completo ? null : statoRef.current);
        statoRef.current = aggiornato;
        setStato(aggiornato);
        setError("");
        // Chi viene approvato dopo la registrazione non passa mai dalla
        // schermata del kit: senza questo avviso resterebbe senza, e non lo
        // saprebbe.
        setNeedsKit(!(await api.me()).recovery_configured);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sincronizzazione non riuscita");
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  // Le modifiche fatte su un altro dispositivo arrivano quando la scheda torna
  // in primo piano: un polling continuo terrebbe sveglio il telefono per nulla.
  useEffect(() => {
    // Due segnali distinti: il ritorno alla scheda, e il ritorno alla finestra
    // dopo essere passati a un'altra applicazione. Legare anche il secondo a
    // visibilityState lo renderebbe codice morto, perche' quando la finestra
    // riceve il focus la scheda e' gia' visibile.
    const suFocus = () => void refresh();
    const suVisibilita = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", suVisibilita);
    window.addEventListener("focus", suFocus);
    return () => {
      document.removeEventListener("visibilitychange", suVisibilita);
      window.removeEventListener("focus", suFocus);
    };
  }, [refresh]);

  if (!session) return null;

  const visible = items.filter((i) =>
    [i.payload.name, i.payload.username, i.payload.url]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  const remove = async (item: DecryptedItem) => {
    if (!window.confirm(`Eliminare "${item.payload.name}"?`)) return;
    await deleteItem(item.id);
    void refresh();
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    signOut();
  };

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-400" />
            <span className="font-semibold text-neutral-100">Vault</span>
          </div>
          <div className="relative ml-auto max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca..."
              className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-9 pr-3 text-sm text-neutral-100 outline-none focus:border-indigo-500"
            />
          </div>
          {session.isAdmin && (
            <Link
              to="/admin"
              title="Amministrazione"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-400 transition hover:bg-neutral-900"
            >
              <Users className="h-4 w-4" />
            </Link>
          )}
          <Link
            to="/settings"
            title="Impostazioni"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <Button variant="ghost" size="icon" onClick={logout} title="Esci">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">Le tue credenziali</h1>
            <p className="text-sm text-neutral-500">
              {items.length} voci · decifrate solo su questo dispositivo
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Nuova voce
          </Button>
        </div>

        {needsKit && !loading && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="flex-1 text-sm text-amber-200/90">
              Non hai un kit di emergenza: se dimentichi la Master Password, questo vault e'
              perso per sempre.
            </span>
            <Link
              to="/settings"
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm font-medium text-amber-200 transition hover:bg-amber-500/10"
            >
              <Printer className="h-3.5 w-3.5" /> Crea il kit
            </Link>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {unreadable.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
            {unreadable.length}{" "}
            {unreadable.length === 1 ? "voce non decifrabile" : "voci non decifrabili"} con questa
            chiave. Le altre sono integre e utilizzabili.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Decifratura del vault...
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 py-20 text-center text-neutral-500">
            {error
              ? "Impossibile caricare il vault."
              : items.length === 0
                ? "Il vault e' vuoto."
                : "Nessun risultato."}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 transition hover:border-neutral-700"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600/15 text-sm font-semibold uppercase text-indigo-400">
                  {item.payload.name.slice(0, 2)}
                </div>
                <button
                  onClick={() => {
                    setEditing(item);
                    setModalOpen(true);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-medium text-neutral-100">{item.payload.name}</div>
                  <div className="truncate text-sm text-neutral-500">
                    {item.payload.username || item.payload.url || "—"}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(item)}
                  className="opacity-0 transition group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4 text-neutral-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>

      {modalOpen && (
        <ItemModal
          session={session}
          item={editing}
          attachments={files.filter((f) => f.item_id === editing?.id)}
          onClose={() => setModalOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
