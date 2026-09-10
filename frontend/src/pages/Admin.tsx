import {
  ArrowLeft,
  Ban,
  Check,
  Database,
  HardDrive,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { api, type AdminStats, type AdminUser } from "../lib/api";

/**
 * Pannello di amministrazione. Mostra conteggi e stato, mai contenuti: la KEK
 * di ogni utente esiste solo sul suo dispositivo, quindi da qui i vault altrui
 * restano illeggibili anche volendo.
 */
export default function Admin() {
  const { session } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api.adminStats(), api.adminUsers()]);
      setStats(s);
      setUsers(u);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caricamento non riuscito");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (session && !session.isAdmin) return <Navigate to="/" replace />;

  const act = async (id: string, action: "approve" | "block") => {
    setBusyId(id);
    setError("");
    try {
      if (action === "approve") await api.adminApprove(id);
      else await api.adminBlock(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operazione non riuscita");
    } finally {
      setBusyId("");
    }
  };

  const pending = users.filter((u) => u.status === "pending");

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <Link to="/" className="text-neutral-500 transition hover:text-neutral-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ShieldCheck className="h-5 w-5 text-amber-400" />
          <span className="font-semibold text-neutral-100">Amministrazione</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Caricamento...
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
                <h2 className="mb-1 font-semibold text-amber-200">
                  {pending.length} {pending.length === 1 ? "richiesta" : "richieste"} in attesa
                </h2>
                <p className="mb-4 text-sm text-amber-200/60">
                  Finche' non li approvi, non possono accedere al proprio vault.
                </p>
                <div className="space-y-2">
                  {pending.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-neutral-100">{u.email}</div>
                        <div className="text-xs text-neutral-500">
                          richiesta del {new Date(u.created_at).toLocaleString("it-IT")}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, "approve")}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Approva
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, "block")}
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" /> Rifiuta
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {stats && (
              <section>
                <h2 className="mb-4 text-lg font-semibold text-neutral-100">Sistema</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard
                    icon={<Users className="h-4 w-4" />}
                    label="Utenti"
                    value={`${stats.users_active} attivi`}
                    detail={`${stats.users_pending} in attesa · ${stats.users_blocked} bloccati`}
                  />
                  <StatCard
                    icon={<Database className="h-4 w-4" />}
                    label="Contenuti"
                    value={`${stats.items_total} voci`}
                    detail={`${stats.files_total} allegati · ${bytes(stats.storage_used_bytes)}`}
                  />
                  <StatCard
                    icon={<HardDrive className="h-4 w-4" />}
                    label="Disco"
                    value={`${bytes(stats.disk_free_bytes)} liberi`}
                    detail={`db ${bytes(stats.db_size_bytes)} · blob ${bytes(stats.blobs_size_bytes)}`}
                  />
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-4 text-lg font-semibold text-neutral-100">Utenti</h2>
              {/* overflow-x-auto e non overflow-hidden: a 375px la tabella e'
                  piu' larga del contenitore e le ultime colonne — spazio usato
                  e pulsante di blocco — erano tagliate via, non scorribili. */}
              <div className="overflow-x-auto rounded-2xl border border-neutral-800">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Utente</th>
                      <th className="px-4 py-3 font-medium">Stato</th>
                      <th className="px-4 py-3 font-medium">Vault</th>
                      <th className="px-4 py-3 font-medium">Spazio</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800 bg-neutral-950">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-100">{u.email}</div>
                          <div className="text-xs text-neutral-600">
                            {u.last_login_at
                              ? `ultimo accesso ${new Date(u.last_login_at).toLocaleDateString("it-IT")}`
                              : "mai entrato"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={u.status} isAdmin={u.is_admin} />
                        </td>
                        <td className="px-4 py-3 text-neutral-400">
                          {u.item_count} voci · {u.file_count} file
                        </td>
                        <td className="px-4 py-3 text-neutral-400">
                          {bytes(u.storage_used_bytes)} / {bytes(u.storage_quota_bytes)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {u.id !== session?.userId && (
                            <Button
                              size="sm"
                              variant={u.status === "active" ? "ghost" : "outline"}
                              disabled={busyId === u.id}
                              onClick={() => act(u.id, u.status === "active" ? "block" : "approve")}
                            >
                              {u.status === "active" ? "Blocca" : "Attiva"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-neutral-600">
                Nessun dato di questa pagina passa dai vault: l'amministratore vede conteggi e
                stato, mai contenuti. Le chiavi per leggerli esistono solo sui dispositivi dei
                singoli utenti.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-neutral-100">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{detail}</div>
    </div>
  );
}

function StatusBadge({ status, isAdmin }: { status: AdminUser["status"]; isAdmin: boolean }) {
  const styles = {
    active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    blocked: "border-red-500/25 bg-red-500/10 text-red-300",
  }[status];
  const label = { active: "attivo", pending: "in attesa", blocked: "bloccato" }[status];

  return (
    <span className="flex items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
        {label}
      </span>
      {isAdmin && (
        <span className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300">
          admin
        </span>
      )}
    </span>
  );
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = value / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
