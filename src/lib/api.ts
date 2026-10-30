export type Pkg = {
  id: number; source_id: number; registry: string; name: string;
  resolved_by: "manifest" | "manual"; manifest_path: string | null; tag_prefix: string | null; muted: number;
};
export type Coverage = { package_id: number; registry: string; name: string; status: CellStatus; lag_hours: number | null };
export type Source = {
  id: number; provider: string; host: string; path: string; url: string;
  default_ref: string | null; track_from: string | null;
  last_synced: string | null; last_error: string | null;
  packages: Pkg[]; latest: string | null; latest_at: string | null; coverage: Coverage[];
};
export type CellStatus = "published" | "missing" | "yanked" | "untagged";
export type Cell = { status: CellStatus; published_at: string | null; url: string | null; lag_hours: number | null };
export type Row = { version: string; prerelease: boolean; git: Cell; packages: Record<number, Cell> };
export type DriftState = "ok" | "pending" | "overdue" | "yanked";
export type DriftItem = {
  source_id: number; source_path: string; host: string; package_id: number; registry: string; name: string;
  muted: boolean; version: string; tagged_at: string | null; git_url: string | null;
  hours: number | null; lag_hours: number | null; state: DriftState;
  registry_latest: string | null; registry_latest_at: string | null;
};
export type Settings = {
  channels: { ntfy: boolean; webhook: boolean }; alert_after_hours: number; poll_minutes: number; public_url: string | null;
};
export type Detail = { source: Source; packages: Pkg[]; rows: Row[] };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  registries: () => req<{ id: string; label: string }[]>("GET", "/api/registries"),
  list: (q = "") => req<Source[]>("GET", `/api/sources${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  add: (url: string, track_from?: string, provider?: string) =>
    req<{ source: Source; candidates: unknown[] }>("POST", "/api/sources", { url, track_from, provider }),
  get: (id: number) => req<Detail>("GET", `/api/sources/${id}`),
  update: (id: number, track_from: string | null) => req<Source>("PATCH", `/api/sources/${id}`, { track_from }),
  remove: (id: number) => req("DELETE", `/api/sources/${id}`),
  sync: (id: number) => req<Source>("POST", `/api/sources/${id}/sync`),
  rescan: (id: number) => req("POST", `/api/sources/${id}/rescan`),
  addPackage: (id: number, registry: string, name: string, tag_prefix?: string) =>
    req<Source>("POST", `/api/sources/${id}/packages`, { registry, name, tag_prefix }),
  setPrefix: (pkgId: number, tag_prefix: string | null) => req("PATCH", `/api/packages/${pkgId}`, { tag_prefix }),
  removePackage: (pkgId: number) => req("DELETE", `/api/packages/${pkgId}`),
  setMuted: (pkgId: number, muted: boolean) => req("PATCH", `/api/packages/${pkgId}`, { muted }),
  drift: () => req<DriftItem[]>("GET", "/api/drift"),
  settings: () => req<Settings>("GET", "/api/settings"),
  testNotify: () => req<{ ok: boolean; delivered: number }>("POST", "/api/notify/test"),
};
