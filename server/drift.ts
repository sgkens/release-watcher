// Drift = the latest stable git release of a package is not (yet) on its registry.
// Computed per package so monorepos (tag prefixes) each get their own "latest".
import { db, type Source } from "./db";
import { channels, notify, type Notice } from "./notify";

const anyChannel = () => { const c = channels(); return c.ntfy || c.webhook; };
import { registries, type RegistryId } from "./registries";
import { matrix } from "./sync";
import { isPrerelease } from "./version";

export const ALERT_AFTER_HOURS = () => Number(process.env.RW_ALERT_AFTER_HOURS ?? 24);

export type DriftState = "ok" | "pending" | "overdue" | "yanked";

export type DriftItem = {
  source_id: number;
  source_path: string;
  host: string;
  package_id: number;
  registry: string;
  name: string;
  muted: boolean;
  version: string;              // latest stable git version for this package
  tagged_at: string | null;
  git_url: string | null;
  hours: number | null;         // since the tag (only for not-yet-published)
  lag_hours: number | null;     // tag → publish (only when published)
  state: DriftState;
  registry_latest: string | null;   // newest version the registry does have
  registry_latest_at: string | null;
};

const bare = (key: string) => {
  const i = key.lastIndexOf("@");
  return i > 0 ? key.slice(i + 1) : key;
};

export function driftFor(source: Source, now = Date.now()): DriftItem[] {
  const { packages, rows } = matrix(source.id);
  const prefixed = packages.some((p) => p.tag_prefix);
  const threshold = ALERT_AFTER_HOURS();
  const out: DriftItem[] = [];

  for (const p of packages) {
    // rows are sorted newest-first within each package group
    const mine = prefixed ? rows.filter((r) => r.version.startsWith(`${p.name}@`)) : rows;
    const latest = mine.find((r) => !r.prerelease && !isPrerelease(bare(r.version)) && r.git.status === "published");
    if (!latest) continue; // nothing tagged to compare against

    // newest version the registry has — prefer a stable one over e.g. 1.0.dev6
    const has = (r: (typeof rows)[number]) => {
      const s = r.packages[p.id]?.status;
      return s === "published" || s === "untagged";
    };
    const onReg = mine.find((r) => has(r) && !isPrerelease(bare(r.version))) ?? mine.find(has);
    const cell = latest.packages[p.id];
    const tagged = latest.git.published_at;
    // the drift clock runs from the anchor (first-seen time for commit-dated tags), not the commit date
    const anchor = latest.git.anchor_at ?? tagged;
    const hours = anchor ? Math.round(((now - Date.parse(anchor)) / 36e5) * 10) / 10 : null;

    let state: DriftState;
    if (cell.status === "yanked") state = "yanked";
    else if (cell.status === "published") state = "ok";
    else state = hours != null && hours < threshold ? "pending" : "overdue";

    out.push({
      source_id: source.id,
      source_path: source.path,
      host: source.host,
      package_id: p.id,
      registry: p.registry,
      name: p.name,
      muted: !!p.muted,
      version: bare(latest.version),
      tagged_at: tagged,
      git_url: latest.git.url,
      hours: state === "ok" ? null : hours,
      lag_hours: state === "ok" ? cell.lag_hours : null,
      state,
      registry_latest: onReg ? bare(onReg.version) : null,
      registry_latest_at: onReg?.packages[p.id]?.published_at ?? null,
    });
  }
  return out;
}

export function allDrift(now = Date.now()): DriftItem[] {
  const sources = db.query<Source, []>("SELECT * FROM sources").all();
  return sources.flatMap((s) => driftFor(s, now));
}

// ---------- alerts ----------

type AlertRow = { id: number; package_id: number; version: string; kind: string; notified_at: string | null };

const regLabel = (r: string) => registries[r as RegistryId]?.label ?? r;

function link(item: DriftItem) {
  const base = process.env.RW_PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}/#/s/${item.source_id}` : item.git_url ?? undefined;
}

function hrs(h: number | null) {
  if (h == null) return "unknown time";
  return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

/**
 * Open/notify alerts for drifting packages, resolve ones that cleared.
 * Each (package, version, kind) notifies at most once; a "landed" follow-up is sent
 * only for alerts that were actually notified and whose version then published.
 * `send` is injectable for tests. Callers must serialise per source (see lock.ts):
 * two overlapping checks could otherwise both see an alert as un-notified and send it twice.
 */
export async function checkAlerts(
  sourceId: number,
  send: (n: Notice) => Promise<number> = notify,
  now = Date.now(),
): Promise<{ opened: number; notified: number; resolved: number }> {
  const s = db.query<Source, [number]>("SELECT * FROM sources WHERE id = ?").get(sourceId);
  if (!s) return { opened: 0, notified: 0, resolved: 0 };

  const items = driftFor(s, now);
  const active = new Set<string>();
  let opened = 0, notified = 0, resolved = 0;

  for (const it of items) {
    const kind = it.state === "overdue" ? "overdue" : it.state === "yanked" ? "yanked" : null;
    if (!kind || it.muted) continue;
    active.add(`${it.package_id}|${it.version}|${kind}`);

    const ins = db.run(
      "INSERT OR IGNORE INTO alerts (source_id, package_id, version, kind) VALUES (?, ?, ?, ?)",
      [s.id, it.package_id, it.version, kind],
    );
    opened += ins.changes;
    const a = db.query<AlertRow & { resolved_at: string | null }, [number, string, string]>(
      "SELECT * FROM alerts WHERE package_id = ? AND version = ? AND kind = ?",
    ).get(it.package_id, it.version, kind)!;
    if (a.resolved_at) {
      // the same problem is back (e.g. the version was unpublished again, or the package was unmuted):
      // reopen so the drift view and alerts never disagree
      db.run("UPDATE alerts SET resolved_at = NULL, notified_at = NULL, opened_at = datetime('now') WHERE id = ?", [a.id]);
      a.notified_at = null;
      opened++;
    }
    if (a.notified_at) continue;

    const sent = await send(
      kind === "overdue"
        ? {
            title: `${it.name} ${it.version} not on ${regLabel(it.registry)}`,
            body: `${it.source_path} tagged ${it.version} ${hrs(it.hours)} ago — not published to ${regLabel(it.registry)} (${it.name}).`
              + (it.registry_latest ? ` Registry is at ${it.registry_latest}.` : ""),
            tags: ["warning", it.registry],
            priority: 4,
            click: link(it),
          }
        : {
            title: `${it.name} ${it.version} yanked on ${regLabel(it.registry)}`,
            body: `${it.source_path}: latest release ${it.version} is yanked/deprecated on ${regLabel(it.registry)}.`,
            tags: ["x", it.registry],
            priority: 4,
            click: link(it),
          },
    );
    if (sent > 0) {
      db.run("UPDATE alerts SET notified_at = datetime('now') WHERE id = ?", [a.id]);
      notified++;
    }
  }

  // resolve alerts that are no longer active
  const open = db.query<AlertRow, [number]>(
    "SELECT * FROM alerts WHERE source_id = ? AND resolved_at IS NULL",
  ).all(s.id);
  for (const a of open) {
    if (active.has(`${a.package_id}|${a.version}|${a.kind}`)) continue;

    // only say "landed" if it really landed (not superseded by a newer tag, not muted)
    const it = items.find((i) => i.package_id === a.package_id && i.version === a.version);
    if (a.notified_at && it?.state === "ok" && !it.muted) {
      const sent = await send({
        title: `${it.name} ${it.version} landed on ${regLabel(it.registry)}`,
        body: `${it.source_path} ${it.version} is now on ${regLabel(it.registry)}`
          + (it.lag_hours != null ? ` (${hrs(it.lag_hours)} after the tag).` : "."),
        tags: ["white_check_mark", it.registry],
        priority: 2,
        click: link(it),
      });
      // delivery failed while a channel is configured: keep the alert open so the next check retries
      if (sent === 0 && anyChannel()) continue;
    }
    db.run("UPDATE alerts SET resolved_at = datetime('now') WHERE id = ?", [a.id]);
    resolved++;
  }

  return { opened, notified, resolved };
}
