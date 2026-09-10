import { Check, ChevronDown, Clock, Copy, Download, Eye, EyeOff, FileText, Loader2, Paperclip, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useModaleTastiera } from "../lib/useModaleTastiera";

import type { FileOut } from "../lib/api";
import type { DecryptedItem, ItemPayload, Session } from "../lib/vault";
import { api } from "../lib/api";
import { createItem, decryptFileMeta, downloadFile, updateItem, uploadFile } from "../lib/vault";
import type { FileMeta } from "../lib/vault";
import { descrizione, ORDINE_TIPI, TIPI, type TipoVoce } from "../lib/tipi";
import { PasswordGenerator } from "./PasswordGenerator";
import { TotpDisplay } from "./TotpDisplay";
import { Button } from "./ui/button";

const EMPTY: ItemPayload = { name: "", username: "", password: "", url: "", notes: "", totp: "" };
const CLIPBOARD_TTL = 20_000;

export function ItemModal({
  session,
  item,
  attachments,
  readOnly = false,
  onClose,
  onSaved,
}: {
  session: Session;
  item: DecryptedItem | null;
  attachments: FileOut[];
  /** Copia locale senza server: si legge e si copia, non si scrive. */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ItemPayload>(item?.payload ?? EMPTY);
  const [revealed, setRevealed] = useState(false);
  const [generatore, setGeneratore] = useState(false);
  const [storicoAperto, setStoricoAperto] = useState(false);
  // Il tipo si sceglie solo alla creazione: cambiarlo su una voce esistente
  // lascerebbe campi popolati ma non piu' visibili, cioe' dati che ci sono e
  // non si vedono. Meglio crearne una nuova.
  const [tipo, setTipo] = useState<TipoVoce>((item?.itemType as TipoVoce) ?? "login");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // I nomi degli allegati sono cifrati come tutto il resto: senza decifrarli
  // l'elenco mostrava solo "244 KB", che non dice nulla su cosa sia il file.
  const [nomi, setNomi] = useState<Record<string, FileMeta>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const contenitore = useModaleTastiera(onClose);

  useEffect(() => {
    setDraft(item?.payload ?? EMPTY);
    setRevealed(false);
    setTipo((item?.itemType as TipoVoce) ?? "login");
  }, [item]);

  useEffect(() => {
    let annullato = false;
    void (async () => {
      const risolti: Record<string, FileMeta> = {};
      for (const f of attachments) {
        try {
          risolti[f.id] = (await decryptFileMeta(session, f)).meta;
        } catch {
          // Un allegato con metadati illeggibili non deve nascondere gli altri.
        }
      }
      if (!annullato) setNomi(risolti);
    })();
    return () => {
      annullato = true;
    };
  }, [attachments, session]);

  const set = (key: keyof ItemPayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  /** La clipboard e' leggibile da qualunque app: si svuota da sola dopo 20s. */
  const copyPassword = async () => {
    if (!draft.password) return;
    await navigator.clipboard.writeText(draft.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === draft.password) await navigator.clipboard.writeText("");
      } catch {
        // Senza permesso di lettura si svuota comunque: meglio perdere un
        // "copia" altrui che lasciare una password in giro.
        await navigator.clipboard.writeText("").catch(() => {});
      }
    }, CLIPBOARD_TTL);
  };

  const save = async () => {
    setBusy("Cifratura...");
    setError("");
    try {
      if (item) await updateItem(session, item, draft);
      else await createItem(session, tipo, draft);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setBusy("");
    }
  };

  const attach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !item) return;
    setBusy("Cifratura dell'allegato...");
    setError("");
    try {
      await uploadFile(session, file, item.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload non riuscito");
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const rimuoviAllegato = async (f: FileOut) => {
    const nome = nomi[f.id]?.name ?? "questo allegato";
    if (!window.confirm(`Eliminare ${nome}? L'operazione non e' reversibile.`)) return;
    setBusy("Eliminazione...");
    setError("");
    try {
      await api.deleteFile(f.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione non riuscita");
    } finally {
      setBusy("");
    }
  };

  const fetchAttachment = async (f: FileOut) => {
    setBusy("Decifratura...");
    try {
      const { blob, meta } = await downloadFile(session, f);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download non riuscito");
    } finally {
      setBusy("");
    }
  };

  const campi = descrizione(tipo).campi;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Clic fuori dalla modale la chiude, ma solo se il gesto e' iniziato
        // fuori: altrimenti trascinare una selezione dal testo verso il bordo
        // chiuderebbe la finestra e farebbe perdere quanto scritto.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contenitore}
        role="dialog"
        aria-modal="true"
        aria-label={readOnly ? "Voce in sola lettura" : item ? "Modifica voce" : "Nuova voce"}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-100">
            {readOnly ? "Voce (sola lettura)" : item ? "Modifica voce" : "Nuova voce"}
          </h2>
          <button onClick={onClose} className="text-neutral-500 transition hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {!item && !readOnly && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">Tipo</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ORDINE_TIPI.map((k) => {
                  const t = TIPI[k];
                  const Icona = t.icona;
                  return (
                    <button
                      key={k}
                      onClick={() => setTipo(k)}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition ${
                        tipo === k
                          ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                          : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
                      }`}
                    >
                      <Icona className="h-4 w-4" />
                      {t.etichetta}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-neutral-600">{TIPI[tipo].suggerimento}</p>
            </div>
          )}

          <Input label="Nome" value={draft.name} onChange={set("name")} placeholder="Banca" readOnly={readOnly} />
          {campi.username && (
            <Input label="Username" value={draft.username ?? ""} onChange={set("username")} readOnly={readOnly} />
          )}

          {campi.carta && (
            <>
              <Input label="Intestatario" value={draft.intestatario ?? ""} onChange={set("intestatario")} readOnly={readOnly} />
              <Input label="Numero" value={draft.numero ?? ""} onChange={set("numero")} readOnly={readOnly} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Scadenza" value={draft.scadenza ?? ""} onChange={set("scadenza")} placeholder="MM/AA" readOnly={readOnly} />
                <Input label="PIN" value={draft.pin ?? ""} onChange={set("pin")} readOnly={readOnly} />
              </div>
            </>
          )}

          {campi.password && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">Password</label>
            {/* min-w-0 sull'input: un campo di testo ha una larghezza
                intrinseca di una ventina di caratteri e con min-width:auto non
                scende sotto quella, spingendo i pulsanti fuori dalla modale a
                375px di larghezza. */}
            <div className="flex gap-2">
              <input
                type={revealed ? "text" : "password"}
                value={draft.password ?? ""}
                onChange={set("password")}
                readOnly={readOnly}
                className="h-10 w-full min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 font-mono text-base text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 sm:text-sm"
              />
              <Button variant="outline" size="icon" onClick={() => setRevealed((v) => !v)}>
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={copyPassword}>
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
              {!readOnly && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setGeneratore((v) => !v)}
                  title="Genera una password"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {generatore && (
              <PasswordGenerator
                onClose={() => setGeneratore(false)}
                onUse={(v) => {
                  setDraft((d) => ({ ...d, password: v }));
                  setRevealed(true);
                  setGeneratore(false);
                }}
              />
            )}
            <p className="text-xs text-neutral-500">
              La clipboard viene svuotata automaticamente dopo 20 secondi.
            </p>
          </div>
          )}

          {(item?.payload.storico?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950">
              <button
                onClick={() => setStoricoAperto((v) => !v)}
                aria-expanded={storicoAperto}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-500 transition hover:text-neutral-300"
              >
                <Clock className="h-3.5 w-3.5" />
                <span className="flex-1">
                  {item!.payload.storico!.length} password precedenti
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${storicoAperto ? "rotate-180" : ""}`}
                />
              </button>
              {storicoAperto && (
                <div className="space-y-1 border-t border-neutral-800 px-3 py-2">
                  {item!.payload.storico!.map((v, idx) => (
                    <VoceStoricoRiga key={idx} voce={v} />
                  ))}
                  <p className="pt-1 text-xs text-neutral-700">
                    Servono quando un sito chiede la vecchia password per cambiarla, o quando un
                    cambio non e' andato a buon fine.
                  </p>
                </div>
              )}
            </div>
          )}

          {campi.url && (
            <Input label="URL" value={draft.url ?? ""} onChange={set("url")} placeholder="https://" readOnly={readOnly} />
          )}

          {campi.totp && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">
              Secret 2FA <span className="text-neutral-600">(opzionale)</span>
            </label>
            <input
              value={draft.totp ?? ""}
              onChange={set("totp")}
              readOnly={readOnly}
              spellCheck={false}
              placeholder="JBSWY3DPEHPK3PXP oppure otpauth://..."
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 font-mono text-sm text-neutral-100 outline-none transition placeholder:font-sans placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
            {draft.totp ? (
              <TotpDisplay secret={draft.totp} />
            ) : (
              <p className="text-xs text-neutral-500">
                Incolla il secret base32 del sito, o direttamente l'URI otpauth:// del QR code.
              </p>
            )}
          </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">Note</label>
            <textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={set("notes")}
              readOnly={readOnly}
              className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          {item && (
            <div className="space-y-2 border-t border-neutral-800 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-neutral-300">Allegati</label>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
                    <Paperclip className="mr-1 h-3.5 w-3.5" /> Aggiungi
                  </Button>
                )}
                <input ref={fileInput} type="file" className="hidden" onChange={attach} />
              </div>
              {attachments.length === 0 ? (
                <p className="text-xs text-neutral-600">Nessun allegato.</p>
              ) : (
                attachments.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-neutral-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-neutral-200">
                        {nomi[f.id]?.name ?? "Nome non decifrabile"}
                      </div>
                      <div className="text-xs text-neutral-600">{dimensione(f.size_bytes)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={readOnly || busy !== ""}
                      title={readOnly ? "Non disponibile senza server" : "Scarica"}
                      onClick={() => fetchAttachment(f)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy !== ""}
                        title="Elimina"
                        onClick={() => rimuoviAllegato(f)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-neutral-500" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-neutral-800 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            {readOnly ? "Chiudi" : "Annulla"}
          </Button>
          {!readOnly && (
          <Button onClick={save} disabled={busy !== "" || !draft.name}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {busy}
              </>
            ) : (
              "Salva"
            )}
          </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Il ciphertext ha 16 byte di tag in piu' del file originale: si mostra la
 *  dimensione reale del contenuto, non quella occupata sul server. */
function dimensione(byteCiphertext: number): string {
  const v = Math.max(0, byteCiphertext - 16);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function VoceStoricoRiga({ voce }: { voce: { password: string; cambiata: string } }) {
  const [mostrata, setMostrata] = useState(false);
  const [copiata, setCopiata] = useState(false);

  const copia = async () => {
    await navigator.clipboard.writeText(voce.password);
    setCopiata(true);
    setTimeout(() => setCopiata(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400">
        {mostrata ? voce.password : "•".repeat(Math.min(voce.password.length, 16))}
      </span>
      <span className="shrink-0 text-xs text-neutral-700">
        {new Date(voce.cambiata).toLocaleDateString("it-IT")}
      </span>
      <button
        onClick={() => setMostrata((v) => !v)}
        title={mostrata ? "Nascondi" : "Mostra"}
        className="shrink-0 text-neutral-600 transition hover:text-neutral-300"
      >
        {mostrata ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={copia}
        title="Copia"
        className="shrink-0 text-neutral-600 transition hover:text-neutral-300"
      >
        {copiata ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Input({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-neutral-300">{label}</label>
      <input
        {...props}
        className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
      />
    </div>
  );
}

