export function ago(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo ago`;
  return `${(s / 86400 / 365).toFixed(1)}y ago`;
}

/** YYYY-MM-DD in the viewer's own timezone (a 20:00Z release is the next day in Sydney). */
export function date(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  return isNaN(+d) ? iso.slice(0, 10) : d.toLocaleDateString("en-CA");
}

/** Full local timestamp for tooltips. */
export function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  return isNaN(+d) ? iso : d.toLocaleString();
}

/** Links come from git hosts and registries; only ever render http(s) ones. */
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : undefined;
  } catch {
    return undefined;
  }
}

/** Lag between git release and registry publish. Negative = published before the tag. */
export function lag(h: number | null): string {
  if (h == null) return "";
  const sign = h < 0 ? "-" : "+";
  const a = Math.abs(h);
  if (a < 1) return `${sign}${Math.round(a * 60)}m`;
  if (a < 48) return `${sign}${Math.round(a)}h`;
  return `${sign}${Math.round(a / 24)}d`;
}

export const REG_LABEL: Record<string, string> = { npm: "npm", jsr: "jsr", crates: "crates", pypi: "pypi" };

export const STATUS: Record<string, { tag: string; cls: string; hint: string }> = {
  published: { tag: "OK", cls: "ok", hint: "published" },
  missing: { tag: "--", cls: "faint", hint: "not on this registry" },
  yanked: { tag: "YANK", cls: "err", hint: "yanked / deprecated" },
  untagged: { tag: "WARN", cls: "warn", hint: "on registry, no matching git release" },
};

/** "svelte@5.1.0" -> "v5.1.0" ; "1.2.3" -> "v1.2.3" */
export function vlabel(key: string): string {
  const i = key.lastIndexOf("@");
  return "v" + (i > 0 ? key.slice(i + 1) : key);
}
