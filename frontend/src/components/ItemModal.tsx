import { Check, Copy, Download, Eye, EyeOff, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FileOut } from "../lib/api";
import type { DecryptedItem, ItemPayload, Session } from "../lib/vault";
import { createItem, downloadFile, updateItem, uploadFile } from "../lib/vault";
import { Button } from "./ui/button";

const EMPTY: ItemPayload = { name: "", username: "", password: "", url: "", notes: "" };
const CLIPBOARD_TTL = 20_000;

export function ItemModal({
  session,
  item,
  attachments,
  onClose,
  onSaved,
}: {
  session: Session;
  item: DecryptedItem | null;
  attachments: FileOut[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ItemPayload>(item?.payload ?? EMPTY);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(item?.payload ?? EMPTY);
    setRevealed(false);
  }, [item]);

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
      else await createItem(session, "login", draft);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-100">
            {item ? "Modifica voce" : "Nuova voce"}
          </h2>
          <button onClick={onClose} className="text-neutral-500 transition hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <Input label="Nome" value={draft.name} onChange={set("name")} placeholder="Banca" />
          <Input label="Username" value={draft.username ?? ""} onChange={set("username")} />

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">Password</label>
            <div className="flex gap-2">
              <input
                type={revealed ? "text" : "password"}
                value={draft.password ?? ""}
                onChange={set("password")}
                className="h-10 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 font-mono text-sm text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              />
              <Button variant="outline" size="icon" onClick={() => setRevealed((v) => !v)}>
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={copyPassword}>
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-neutral-500">
              La clipboard viene svuotata automaticamente dopo 20 secondi.
            </p>
          </div>

          <Input label="URL" value={draft.url ?? ""} onChange={set("url")} placeholder="https://" />

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">Note</label>
            <textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={set("notes")}
              className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          {item && (
            <div className="space-y-2 border-t border-neutral-800 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-neutral-300">Allegati</label>
                <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
                  <Paperclip className="mr-1 h-3.5 w-3.5" /> Aggiungi
                </Button>
                <input ref={fileInput} type="file" className="hidden" onChange={attach} />
              </div>
              {attachments.length === 0 ? (
                <p className="text-xs text-neutral-600">Nessun allegato.</p>
              ) : (
                attachments.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  >
                    <span className="truncate font-mono text-xs text-neutral-400">
                      {(f.size_bytes / 1024).toFixed(0)} KB
                    </span>
                    <Button variant="ghost" size="icon-sm" onClick={() => fetchAttachment(f)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
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
            Annulla
          </Button>
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
        </div>
      </div>
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

export { Trash2 };
