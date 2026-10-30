import { db, reindex, type Package, type Release, type Source } from "./db";
import { providers } from "./providers";
import type { ProviderId, RepoRef } from "./providers/types";
import { registries, type RegistryId } from "./registries";
import { compare, isPrerelease, normalise } from "./version";

// Git rows (package_id NULL) are unique via the partial index ux_releases_git;
// registry rows via the table UNIQUE (package_id is never NULL for them).
const upsertGit = db.prepare(`
  INSERT INTO releases (source_id, package_id, origin, version, raw, published_at, url, prerelease, yanked, seen_at, dated_by)
  VALUES ($source_id, NULL, 'git', $version, $raw, $published_at, $url, $prerelease, 0, datetime('now'), $dated_by)
  ON CONFLICT (source_id, raw) WHERE package_id IS NULL DO UPDATE SET
    version = excluded.version, published_at = excluded.published_at, url = excluded.url,
    prerelease = excluded.prerelease, dated_by = excluded.dated_by
`);
const upsertReg = db.prepare(`
  INSERT INTO releases (source_id, package_id, origin, version, raw, published_at, url, prerelease, yanked, seen_at, dated_by)
  VALUES ($source_id, $package_id, $origin, $version, $raw, $published_at, $url, $prerelease, $yanked, datetime('now'), 'release')
  ON CONFLICT (source_id, origin, package_id, raw) DO UPDATE SET
    version = excluded.version, published_at = excluded.published_at, url = excluded.url,
    prerelease = excluded.prerelease, yanked = excluded.yanked
`);

const after = (date: string | null, from: string | null) => !from || !date || date >= from;

/**
 * Remove rows that upstream no longer lists (deleted release, unpublished version).
 * Only within the window the fetch actually covered: APIs return the newest page only,
 * so anything older than the oldest returned item is left alone.
 */
function prune(sourceId: number, packageId: number | null, fetched: { raw: string; published_at: string | null }[]) {
  if (!fetched.length) return; // an empty answer is more likely an API hiccup than a wiped history
  const dates = fetched.map((f) => f.published_at).filter((d): d is string => !!d).sort();
  const oldest = dates[0] ?? null;
  const keep = new Set(fetched.map((f) => f.raw));
  const rows = db.query<{ id: number; raw: string; published_at: string | null }, [number, number | null]>(
    "SELECT id, raw, published_at FROM releases WHERE source_id = ? AND package_id IS ?",
  ).all(sourceId, packageId);
  for (const r of rows) {
    if (keep.has(r.raw)) continue;
    if (oldest && r.published_at && r.published_at < oldest) continue; // outside the fetched page
    db.run("DELETE FROM releases WHERE id = ?", [r.id]);
  }
}

export async function syncSource(id: number): Promise<void> {
  const s = db.query<Source, [number]>("SELECT * FROM sources WHERE id = ?").get(id);
  if (!s) throw new Error(`source ${id} not found`);
  const ref: RepoRef = { provider: s.provider as ProviderId, host: s.host, path: s.path };
  const errors: string[] = [];

  try {
    const git = (await providers[ref.provider].releases(ref)).filter((r) => after(r.published_at, s.track_from));
    db.transaction(() => {
      for (const r of git) {
        const version = normalise(r.tag) ?? r.tag;
        upsertGit.run({
          source_id: s.id, version, raw: r.tag, published_at: r.published_at, url: r.url,
          prerelease: r.prerelease || isPrerelease(version) ? 1 : 0, dated_by: r.dated_by,
        });
      }
      prune(s.id, null, git.map((r) => ({ raw: r.tag, published_at: r.published_at })));
    })();
  } catch (e: any) {
    errors.push(`git: ${e.message}`);
  }

  const pkgs = db.query<Package, [number]>("SELECT * FROM packages WHERE source_id = ?").all(s.id);
  await Promise.all(
    pkgs.map(async (p) => {
      try {
        const versions = (await registries[p.registry as RegistryId].versions(p.name))
          .filter((v) => after(v.published_at, s.track_from));
        db.transaction(() => {
          for (const v of versions) {
            const version = normalise(v.version) ?? v.version;
            upsertReg.run({
              source_id: s.id, package_id: p.id, origin: p.registry,
              version, raw: v.version, published_at: v.published_at, url: v.url,
              prerelease: isPrerelease(version) ? 1 : 0, yanked: v.yanked ? 1 : 0,
            });
          }
          prune(s.id, p.id, versions.map((v) => ({ raw: v.version, published_at: v.published_at })));
        })();
      } catch (e: any) {
        errors.push(`${p.registry}:${p.name}: ${e.message}`);
      }
    }),
  );

  db.run("UPDATE sources SET last_synced = datetime('now'), last_error = ? WHERE id = ?", [
    errors.length ? errors.join("\n") : null, s.id,
  ]);
  reindex(s.id);
}

// ---------- matrix: git releases stacked against each registry ----------

export type Cell = {
  status: "published" | "missing" | "yanked" | "untagged";
  published_at: string | null;
  url: string | null;
  lag_hours: number | null; // registry publish time minus git release time
  /** git cells only: when the tag can be trusted to have existed (drift clock starts here) */
  anchor_at?: string | null;
};

export type MatrixRow = { version: string; prerelease: boolean; git: Cell; packages: Record<number, Cell> };

const sqliteToIso = (d: string | null) => (d && !d.includes("T") ? d.replace(" ", "T") + "Z" : d);

function gitCell(g: Release): Cell {
  // A tag-fallback date is the commit's date, which can be weeks older than the tag itself.
  // For those, the clock starts no earlier than when we first saw the tag.
  let anchor = g.published_at;
  const seen = sqliteToIso(g.seen_at);
  if (g.dated_by === "commit" && seen && (!anchor || seen > anchor)) anchor = seen;
  return { status: "published", published_at: g.published_at, url: g.url, lag_hours: null, anchor_at: anchor };
}

export function matrix(sourceId: number): { packages: Package[]; rows: MatrixRow[] } {
  const pkgs = db.query<Package, [number]>("SELECT * FROM packages WHERE source_id = ? ORDER BY registry, name").all(sourceId);
  const rels = db.query<Release, [number]>("SELECT * FROM releases WHERE source_id = ?").all(sourceId);
  const git = rels.filter((r) => r.package_id === null);

  const rows = new Map<string, MatrixRow>();
  const empty = (status: Cell["status"]): Cell => ({ status, published_at: null, url: null, lag_hours: null });
  const row = (key: string, pre: boolean) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { version: key, prerelease: pre, git: empty("missing"), packages: {} }));
    else if (pre) r.prerelease = true;
    return r;
  };

  // Lockstep mode (no prefixes anywhere): one shared row per version.
  // Grouped mode (any package has a prefix): every package gets its own rows keyed "name@version".
  //   - a package with a prefix owns the tags that start with it
  //   - a package without one owns the tags that match *no* other package's prefix
  const prefixes = pkgs.map((p) => p.tag_prefix).filter((x): x is string => !!x);
  const grouped = prefixes.length > 0;

  if (!grouped) {
    for (const g of git) {
      const v = normalise(g.raw);
      if (!v) continue; // non-version tags ("nightly", "latest") never form rows
      row(v, !!g.prerelease || isPrerelease(v)).git = gitCell(g);
    }
  }

  for (const p of pkgs) {
    const key = (v: string) => (grouped ? `${p.name}@${v}` : v);
    if (grouped) {
      for (const g of git) {
        const v = p.tag_prefix
          ? normalise(g.raw, p.tag_prefix)
          : prefixes.some((px) => g.raw.startsWith(px)) ? null : normalise(g.raw);
        if (v) row(key(v), !!g.prerelease || isPrerelease(v)).git = gitCell(g);
      }
    }
    for (const r of rels.filter((r) => r.package_id === p.id)) {
      const mr = row(key(r.version), !!r.prerelease);
      const gitDate = mr.git.published_at;
      mr.packages[p.id] = {
        status: r.yanked ? "yanked" : mr.git.status === "missing" ? "untagged" : "published",
        published_at: r.published_at,
        url: r.url,
        lag_hours: gitDate && r.published_at
          ? Math.round(((Date.parse(r.published_at) - Date.parse(gitDate)) / 36e5) * 10) / 10
          : null,
      };
    }
  }

  // fill holes
  for (const r of rows.values()) for (const p of pkgs) r.packages[p.id] ??= empty("missing");

  const sorted = [...rows.values()].sort((a, b) => {
    const [na, va] = splitKey(a.version), [nb, vb] = splitKey(b.version);
    return na === nb ? compare(vb, va) : na.localeCompare(nb);
  });
  return { packages: pkgs, rows: sorted };
}

export const splitKey = (k: string): [string, string] => {
  const i = k.lastIndexOf("@");
  return i > 0 ? [k.slice(0, i), k.slice(i + 1)] : ["", k];
};
