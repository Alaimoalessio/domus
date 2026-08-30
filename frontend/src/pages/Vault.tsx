import { KeyRound, Loader2, LogOut, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ItemModal } from "../components/ItemModal";
import { RecoveryKit } from "../components/RecoveryKit";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api, type FileOut } from "../lib/api";
import { createRecoveryKit, deleteItem, loadVault, type DecryptedItem } from "../lib/vault";

export default function Vault() {
  const { session, email, signOut } = useAuth();
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [files, setFiles] = useState<FileOut[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<DecryptedItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newKit, setNewKit] = useState("");

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const state = await loadVault(session);
      setItems(state.items);
      setFiles(state.files);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sincronizzazione non riuscita");
    } finally {
      setLoading(false);
    }
  }, [session]);

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
        onDone={() => setNewKit("")}
      />
    );
  }

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

  const rotateKit = async () => {
    if (
      !window.confirm(
        "Generare un nuovo kit di emergenza? Il codice stampato in precedenza smettera' di funzionare."
      )
    )
      return;
    setNewKit(await createRecoveryKit(session));
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
          <Button variant="ghost" size="icon" onClick={rotateKit} title="Nuovo kit di emergenza">
            <KeyRound className="h-4 w-4" />
          </Button>
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

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Decifratura del vault...
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 py-20 text-center text-neutral-500">
            {items.length === 0 ? "Il vault e' vuoto." : "Nessun risultato."}
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
