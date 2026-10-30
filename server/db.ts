import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.RW_DB ?? "data/release-watcher.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY,
  provider      TEXT NOT NULL,              -- github | gitlab | gitea
  host          TEXT NOT NULL,              -- github.com, gitlab.com, codeberg.org, git.home.lan ...
  path          TEXT NOT NULL,              -- owner/repo (gitlab: full namespace path)
  url           TEXT NOT NULL,
  default_ref   TEXT,
  track_from    TEXT,                       -- ISO date; ignore releases older than this
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced   TEXT,
  last_error    TEXT,
  UNIQUE (host, path)
);

CREATE TABLE IF NOT EXISTS packages (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  registry      TEXT NOT NULL,              -- npm | jsr | crates | pypi
  name          TEXT NOT NULL,
  resolved_by   TEXT NOT NULL,              -- manifest | manual
  manifest_path TEXT,
  tag_prefix    TEXT,                       -- monorepo tags like "pkg@" or "pkg-v"
  UNIQUE (source_id, registry, name)
);

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  package_id    INTEGER REFERENCES packages(id) ON DELETE CASCADE,  -- NULL = git
  origin        TEXT NOT NULL,              -- git | npm | jsr | crates | pypi
  version       TEXT NOT NULL,              -- normalised (no leading v / prefix)
  raw           TEXT NOT NULL,              -- tag name or registry version as published
  published_at  TEXT,
  url           TEXT,
  prerelease    INTEGER NOT NULL DEFAULT 0,
  yanked        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_id, origin, package_id, raw)
);

CREATE INDEX IF NOT EXISTS ix_releases_source ON releases(source_id, version);

-- search over sources + package names
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(source_id UNINDEXED, text);

-- one row per (package, version, kind) so each drift is notified once, and once more when it resolves
CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  package_id    INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- overdue | yanked
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at   TEXT,
  resolved_at   TEXT,
  UNIQUE (package_id, version, kind)
);
`);

// additive migrations for existing databases
function addColumn(table: string, col: string, ddl: string) {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn("packages", "muted", "muted INTEGER NOT NULL DEFAULT 0"); // still shown in drift, never alerts
// when we first saw a row; anchors drift for tag-only repos where the date is a commit date
addColumn("releases", "seen_at", "seen_at TEXT");
// 'release' (a real release date) or 'commit' (tag fallback: date of the tagged commit)
addColumn("releases", "dated_by", "dated_by TEXT");

// Git rows have package_id NULL, and SQLite treats NULLs as distinct in UNIQUE constraints,
// so the table-level UNIQUE never matched them and every sync re-inserted them (v0.2 bug).
// Collapse duplicates, then enforce uniqueness with a partial index the upsert targets.
db.transaction(() => {
  db.run(`DELETE FROM releases WHERE package_id IS NULL AND id NOT IN (
            SELECT MAX(id) FROM releases WHERE package_id IS NULL GROUP BY source_id, raw)`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_releases_git ON releases(source_id, raw) WHERE package_id IS NULL");
})();

export type Source = {
  id: number; provider: string; host: string; path: string; url: string;
  default_ref: string | null; track_from: string | null;
  added_at: string; last_synced: string | null; last_error: string | null;
};
export type Package = {
  id: number; source_id: number; registry: string; name: string;
  resolved_by: string; manifest_path: string | null; tag_prefix: string | null; muted: number;
};
export type Release = {
  id: number; source_id: number; package_id: number | null; origin: string;
  version: string; raw: string; published_at: string | null; url: string | null;
  prerelease: number; yanked: number; seen_at: string | null; dated_by: string | null;
};

export function reindex(sourceId: number) {
  const s = db.query<Source, [number]>("SELECT * FROM sources WHERE id = ?").get(sourceId);
  if (!s) return;
  const pkgs = db.query<Package, [number]>("SELECT * FROM packages WHERE source_id = ?").all(sourceId);
  db.run("DELETE FROM search WHERE source_id = ?", [sourceId]);
  db.run("INSERT INTO search (source_id, text) VALUES (?, ?)", [
    sourceId,
    [s.host, s.path, ...pkgs.map((p) => `${p.registry}:${p.name} ${p.name}`)].join(" "),
  ]);
}
