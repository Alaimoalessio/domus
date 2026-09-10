/**
 * Client HTTP del backend. Nessuna logica crittografica qui: questo strato
 * vede solo ciphertext opaco, esattamente come il server.
 */

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  protected_symmetric_key: string;
  protected_key_nonce: string;
  is_admin: boolean;
}

export interface PreloginResponse {
  kdf_algorithm: string;
  kdf_salt: string;
  kdf_memory_kib: number;
  kdf_iterations: number;
  kdf_parallelism: number;
}

export interface RecoveryPreloginResponse {
  kdf_algorithm: string;
  recovery_salt: string;
  recovery_kdf_memory_kib: number;
  recovery_kdf_iterations: number;
  recovery_kdf_parallelism: number;
}

export interface ItemOut {
  id: string;
  item_type: string;
  nonce: string;
  ciphertext: string;
  wrapped_key: string;
  wrapped_key_nonce: string;
  revision: number;
  seq: number;
  created_at: string;
  updated_at: string;
}

export interface FileOut {
  id: string;
  item_id: string | null;
  size_bytes: number;
  sha256: string;
  nonce: string;
  wrapped_file_key: string;
  wrapped_key_nonce: string;
  metadata_ct: string;
  metadata_nonce: string;
  status: string;
  seq: number;
  created_at: string;
}

export interface TrashItemOut extends ItemOut {
  deleted_at: string;
  attachments: number;
}

export interface SyncResponse {
  seq: number;
  items: ItemOut[];
  files: FileOut[];
  tombstones: { id: string; seq: number; deleted_at: string }[];
  file_tombstones: { id: string; seq: number; deleted_at: string }[];
}

export interface AdminStats {
  users_total: number;
  users_active: number;
  users_pending: number;
  users_blocked: number;
  items_total: number;
  files_total: number;
  storage_used_bytes: number;
  db_size_bytes: number;
  blobs_size_bytes: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
}

export interface AdminUser {
  id: string;
  email: string;
  status: "pending" | "active" | "blocked";
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  item_count: number;
  file_count: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
}

export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
}

export interface TotpStatus {
  enabled: boolean;
  pending: boolean;
  confirmed_at: string | null;
}

export interface SessionOut {
  id: string;
  device_label: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}

export interface MeResponse {
  id: string;
  email: string;
  is_admin: boolean;
  status: string;
  vault_seq: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  recovery_configured: boolean;
  totp_enabled: boolean;
}

async function toError(res: Response): Promise<ApiError> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
    else if (Array.isArray(body?.detail)) detail = body.detail[0]?.msg ?? detail;
  } catch {
    /* risposta senza corpo JSON */
  }
  return new ApiError(res.status, detail);
}

export class Api {
  accessToken: string | null = null;
  refreshToken: string | null = null;
  private refreshing: Promise<void> | null = null;

  setTokens(t: Tokens) {
    this.accessToken = t.access_token;
    this.refreshToken = t.refresh_token;
  }

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
  }

  /** Scambia un refresh token per una sessione. Lo usa lo sblocco biometrico,
   *  che parte da un refresh token conservato e non da un access token. */
  async rinnovaSessione(refreshToken: string): Promise<Tokens> {
    const r = await this.raw(
      "/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      false
    );
    if (!r.ok) throw await toError(r);
    const t: Tokens = await r.json();
    this.setTokens(t);
    return t;
  }

  private async raw(path: string, init: RequestInit, auth: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth && this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    return fetch(`${BASE}${path}`, { ...init, headers });
  }

  /** L'access token vive 15 minuti: un 401 su una sessione viva significa
   *  quasi sempre "scaduto", non "revocato". Si rinnova una volta sola e in
   *  modo condiviso, o N richieste parallele farebbero N rotazioni. */
  private async withRefresh(path: string, init: RequestInit): Promise<Response> {
    let res = await this.raw(path, init, true);
    if (res.status !== 401 || !this.refreshToken) return res;

    if (!this.refreshing) {
      this.refreshing = (async () => {
        const r = await this.raw(
          "/auth/refresh",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: this.refreshToken }),
          },
          false
        );
        if (!r.ok) {
          this.clear();
          throw await toError(r);
        }
        const t: Tokens = await r.json();
        this.accessToken = t.access_token;
        this.refreshToken = t.refresh_token;
      })().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
    res = await this.raw(path, init, true);
    return res;
  }

  private async json<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const withHeaders = { ...init, headers };
    const res = auth
      ? await this.withRefresh(path, withHeaders)
      : await this.raw(path, withHeaders, false);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ----------------------------------------------------------------- auth
  register(body: unknown) {
    return this.json<{ id: string; status: string; is_admin: boolean }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(body) },
      false
    );
  }

  prelogin(email: string) {
    return this.json<PreloginResponse>(
      "/auth/prelogin",
      { method: "POST", body: JSON.stringify({ email }) },
      false
    );
  }

  login(email: string, authKey: string, deviceLabel: string, totpCode?: string) {
    return this.json<Tokens>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          auth_key: authKey,
          device_label: deviceLabel,
          totp_code: totpCode ?? null,
        }),
      },
      false
    );
  }

  totpStatus() {
    return this.json<TotpStatus>("/auth/2fa/status");
  }

  totpSetup() {
    return this.json<TotpSetup>("/auth/2fa/setup", { method: "POST" });
  }

  totpActivate(code: string) {
    return this.json<void>("/auth/2fa/activate", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  totpDisable(code: string) {
    return this.json<void>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  me() {
    return this.json<MeResponse>("/auth/me");
  }

  logout() {
    return this.json<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
  }

  sessions() {
    return this.json<SessionOut[]>("/auth/sessions");
  }

  revokeSession(id: string) {
    return this.json<void>(`/auth/sessions/${id}`, { method: "DELETE" });
  }

  changeMasterPassword(body: unknown) {
    return this.json<Tokens>("/auth/master-password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ------------------------------------------------------- kit di emergenza
  recoverySetup(body: unknown) {
    return this.json<void>("/auth/recovery/setup", { method: "POST", body: JSON.stringify(body) });
  }

  recoveryPrelogin(email: string) {
    return this.json<RecoveryPreloginResponse>(
      "/auth/recovery/prelogin",
      { method: "POST", body: JSON.stringify({ email }) },
      false
    );
  }

  recoveryStart(email: string, recoveryAuthKey: string) {
    return this.json<{
      recovery_token: string;
      expires_in: number;
      user_id: string;
      recovery_key_blob: string;
      recovery_key_nonce: string;
    }>(
      "/auth/recovery/start",
      {
        method: "POST",
        body: JSON.stringify({ email, recovery_auth_key: recoveryAuthKey }),
      },
      false
    );
  }

  async recoveryComplete(recoveryToken: string, body: unknown): Promise<Tokens> {
    // Token con scope "recovery": non passa dal refresh, vale una volta sola.
    const res = await fetch(`${BASE}/auth/recovery/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${recoveryToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as Tokens;
  }

  // ---------------------------------------------------------------- vault
  sync(since = 0) {
    return this.json<SyncResponse>(`/vault/sync?since=${since}`);
  }

  createItem(body: unknown) {
    return this.json<ItemOut>("/vault/items", { method: "POST", body: JSON.stringify(body) });
  }

  updateItem(id: string, body: unknown) {
    return this.json<ItemOut>(`/vault/items/${id}`, { method: "PUT", body: JSON.stringify(body) });
  }

  deleteItem(id: string) {
    return this.json<void>(`/vault/items/${id}`, { method: "DELETE" });
  }

  trash() {
    return this.json<TrashItemOut[]>("/vault/trash");
  }

  restoreItem(id: string) {
    return this.json<ItemOut>(`/vault/items/${id}/restore`, { method: "POST" });
  }

  // ---------------------------------------------------------------- files
  fileInit(body: unknown) {
    return this.json<{ file_id: string; upload_url: string; max_bytes: number }>("/files/init", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async fileUpload(fileId: string, blob: Uint8Array<ArrayBuffer>): Promise<FileOut> {
    const res = await this.withRefresh(`/files/${fileId}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob as BodyInit,
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as FileOut;
  }

  async fileDownload(fileId: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.withRefresh(`/files/${fileId}/content`, { method: "GET" });
    if (!res.ok) throw await toError(res);
    return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  }

  deleteFile(id: string) {
    return this.json<void>(`/files/${id}`, { method: "DELETE" });
  }

  // ---------------------------------------------------------------- admin
  // Nessuno di questi endpoint restituisce ciphertext o chiavi wrappate:
  // l'admin conta e amministra, non legge i vault altrui.
  adminStats() {
    return this.json<AdminStats>("/admin/stats");
  }

  adminUsers() {
    return this.json<AdminUser[]>("/admin/users");
  }

  adminApprove(userId: string) {
    return this.json<void>(`/admin/users/${userId}/approve`, { method: "POST" });
  }

  adminBlock(userId: string) {
    return this.json<void>(`/admin/users/${userId}/block`, { method: "POST" });
  }

  adminQuota(userId: string, bytes: number) {
    return this.json<void>(`/admin/users/${userId}/quota`, {
      method: "POST",
      body: JSON.stringify({ storage_quota_bytes: bytes }),
    });
  }
}

export const api = new Api();
