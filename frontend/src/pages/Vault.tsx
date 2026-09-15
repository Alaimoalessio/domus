import { ArrowUpDown, Check, CloudOff, Copy, KeyRound, Loader2, Lock, LogOut, Plus, Printer, RectangleEllipsis, Search, Settings, ShieldCheck, Star, Stethoscope, Trash2, TriangleAlert, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { HealthPanel } from "../components/HealthPanel";
import { descrizione } from "../lib/tipi";
import { ItemModal } from "../components/ItemModal";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { useVault } from "../context/VaultContext";
import { api } from "../lib/api";
import { copiaSegreto } from "../lib/clipboard";
import { deleteItem, updateItem, type DecryptedItem } from "../lib/vault";

/** Una nota non ha username e una carta nemmeno: mostrare "—" sprecherebbe la
 *  riga proprio sui tipi dove il nome da solo dice meno. */
function sottotitolo(item: DecryptedItem): string {
  const p = item.payload;
  if (p.username) return p.username;
  if (p.numero) return `•••• ${p.numero.replace(/\s/g, "").slice(-4)}`;
  if (p.notes) return p.notes.split("\n")[0].slice(0, 60);
  return p.url ?? "—";
}

export default function Vault() {
  const { session, signOut, lock } = useAuth();
  const { stato, loading, error, refresh } = useVault();
  const items = stato.items;
  const files = stato.files;
  const unreadable = stato.unreadable;
  const [query, setQuery] = useState("");
  const [needsKit, setNeedsKit] = useState(false);
  const [saluteAperta, setSaluteAperta] = useState(false);
  const [ordine, setOrdine] = useState<"nome" | "recenti">("nome");
  const campoRicerca = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<DecryptedItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Aggiornamento ottimistico: segnare un preferito deve sembrare istantaneo,
  // non far aspettare una risposta dal server per un asterisco.
  const [preferitiInCorso, setPreferitiInCorso] = useState<Record<string, boolean>>({});
  // Copia rapida dall'elenco: l'operazione piu' frequente non deve passare
  // dalla maschera di modifica.
  const [copiato, setCopiato] = useState<string>("");

  // Chi viene approvato dopo la registrazione non passa mai dalla schermata
  // del kit: senza questo avviso resterebbe senza, e non lo saprebbe.
  useEffect(() => {
    if (!session || session.offline) return;
    api
      .me()
      .then((me) => setNeedsKit(!me.recovery_configured))
      .catch(() => {});
  }, [session]);

  // Scorciatoie da tastiera. "/" per cercare e' la convenzione del web; il
  // tasto va ignorato mentre si scrive, o non si potrebbe piu' digitare una
  // barra dentro un campo.
  useEffect(() => {
    const suTasto = (e: KeyboardEvent) => {
      const dentroUnCampo =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable);

      if (e.key === "Escape" && dentroUnCampo && e.target === campoRicerca.current) {
        setQuery("");
        campoRicerca.current?.blur();
        return;
      }
      // Con una modale aperta il focus e' confinato li' dentro, ma su un
      // pulsante "n" passerebbe comunque e aprirebbe una seconda modale sopra.
      if (dentroUnCampo || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        campoRicerca.current?.focus();
      } else if (e.key.toLowerCase() === "n" && !session?.offline) {
        e.preventDefault();
        setEditing(null);
        setModalOpen(true);
      }
    };
    document.addEventListener("keydown", suTasto);
    return () => document.removeEventListener("keydown", suTasto);
  }, [session, modalOpen]);

  if (!session) return null;

  // I preferiti stanno sempre in cima, qualunque sia l'ordinamento: e' il
  // motivo per cui li si segna.
  // La ricerca guarda anche note e campi personalizzati: il numero cliente
  // finito in un campo libero deve essere trovabile come il nome del sito.
  const q = query.toLowerCase();
  const visible = items
    .filter((i) =>
      [
        i.payload.name,
        i.payload.username,
        i.payload.url,
        i.payload.notes,
        ...(i.payload.campi ?? []).flatMap((c) => [c.nome, c.nascosto ? "" : c.valore]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
    .sort((a, b) => {
      const pa = ePreferito(a) ? 0 : 1;
      const pb = ePreferito(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return ordine === "nome"
        ? a.payload.name.localeCompare(b.payload.name, "it")
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const alternaPreferito = async (item: DecryptedItem) => {
    const invertito = !item.payload.preferito;
    setPreferitiInCorso((p) => ({ ...p, [item.id]: invertito }));
    try {
      await updateItem(session, item, { ...item.payload, preferito: invertito });
      await refresh();
    } finally {
      setPreferitiInCorso((p) => {
        const resto = { ...p };
        delete resto[item.id];
        return resto;
      });
    }
  };
  const ePreferito = (item: DecryptedItem) => preferitiInCorso[item.id] ?? !!item.payload.preferito;

  const copia = async (chiave: string, testo: string | undefined) => {
    if (!testo) return;
    await copiaSegreto(testo);
    setCopiato(chiave);
    setTimeout(() => setCopiato((c) => (c === chiave ? "" : c)), 1500);
  };

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
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-400" />
            <span className="font-semibold text-neutral-100">Domus</span>
          </div>
          {/* Su mobile la ricerca prende una riga intera: schiacciata fra logo
              e tre icone diventava un campo da pochi caratteri. */}
          <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-auto sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
            <input
              ref={campoRicerca}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca..."
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-9 pr-9 text-base text-neutral-100 outline-none focus:border-indigo-500 sm:h-9 sm:text-sm"
            />
            {/* Il suggerimento sparisce appena si scrive: a quel punto ha gia'
                fatto il suo lavoro e occuperebbe solo spazio. */}
            {query === "" && (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-600 sm:block">
                /
              </kbd>
            )}
          </div>
          {session.isAdmin && !session.offline && (
            <Link
              to="/admin"
              title="Amministrazione"
              className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-amber-400 transition hover:bg-neutral-900 sm:ml-0 sm:h-8 sm:w-8"
            >
              <Users className="h-4 w-4" />
            </Link>
          )}
          <Link
            to="/codici"
            title="Codici 2FA"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 sm:h-8 sm:w-8"
          >
            <RectangleEllipsis className="h-4 w-4" />
          </Link>
          <Link
            to="/settings"
            title="Impostazioni"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 sm:h-8 sm:w-8"
          >
            <Settings className="h-4 w-4" />
          </Link>
          {!session.offline && (
            <Button variant="ghost" size="icon" onClick={lock} title="Blocca (la sessione resta)">
              <Lock className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={logout} title="Esci (rimuove PIN e impronta da questo dispositivo)">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">Le tue credenziali</h1>
            <p className="text-sm text-neutral-500">
              {items.length} voci · decifrate solo su questo dispositivo
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOrdine(ordine === "nome" ? "recenti" : "nome")}
              title="Cambia ordinamento"
            >
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
              {ordine === "nome" ? "A-Z" : "Recenti"}
            </Button>
            {!session.offline && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Nuova voce
              </Button>
            )}
          </div>
        </div>

        {session.offline && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-sky-500/25 bg-sky-500/5 px-4 py-3">
            <CloudOff className="h-4 w-4 shrink-0 text-sky-400" />
            <span className="text-sm text-sky-200/90">
              Copia locale, sola lettura: il server non e' raggiungibile. Le modifiche torneranno
              possibili appena si ricollega.
            </span>
          </div>
        )}

        {needsKit && !session.offline && !loading && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="flex-1 text-sm text-amber-200/90">
              Non hai un kit di emergenza: se dimentichi la Master Password, questo vault e'
              perso per sempre.
            </span>
            <Link
              to="/settings"
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/10"
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

        {!loading && items.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setSaluteAperta((v) => !v)}
              aria-expanded={saluteAperta}
              className="mb-2 flex items-center gap-2 text-sm text-neutral-500 transition hover:text-neutral-300"
            >
              <Stethoscope className="h-4 w-4" />
              {saluteAperta ? "Nascondi il controllo" : "Controlla la salute del vault"}
            </button>
            {saluteAperta && (
              <HealthPanel
                items={items}
                onApri={(item) => {
                  setEditing(item);
                  setModalOpen(true);
                }}
              />
            )}
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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600/15 text-indigo-400">
                  {(() => {
                    const Icona = descrizione(item.itemType).icona;
                    return <Icona className="h-4 w-4" />;
                  })()}
                </div>
                <button
                  onClick={() => {
                    setEditing(item);
                    setModalOpen(true);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-medium text-neutral-100">{item.payload.name}</div>
                  <div className="truncate text-sm text-neutral-500">{sottotitolo(item)}</div>
                </button>
                {item.payload.username && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={`Copia utente: ${item.payload.username}`}
                    onClick={() => copia(`${item.id}:u`, item.payload.username)}
                  >
                    {copiato === `${item.id}:u` ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-neutral-500" />
                    )}
                  </Button>
                )}
                {item.payload.password && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Copia password"
                    onClick={() => copia(`${item.id}:p`, item.payload.password)}
                  >
                    {copiato === `${item.id}:p` ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <KeyRound className="h-4 w-4 text-neutral-500" />
                    )}
                  </Button>
                )}
                {/* Il cestino resta visibile di default e si nasconde solo
                    dove esiste un puntatore: su un telefono l'hover non c'e',
                    e con opacity-0 di base non compariva mai — la voce non era
                    cancellabile affatto. */}
                {!session.offline && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={ePreferito(item) ? "Togli dai preferiti" : "Aggiungi ai preferiti"}
                    onClick={() => alternaPreferito(item)}
                    className={ePreferito(item) ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"}
                  >
                    <Star
                      className={`h-4 w-4 ${ePreferito(item) ? "fill-amber-400 text-amber-400" : "text-neutral-500"}`}
                    />
                  </Button>
                )}
                {!session.offline && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(item)}
                    className="opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4 text-neutral-500" />
                  </Button>
                )}
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
          readOnly={session.offline}
          onClose={() => setModalOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
