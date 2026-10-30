import { join, normalize, resolve, sep } from "node:path";
import { db, reindex, type Package, type Source } from "./db";
import { allDrift, ALERT_AFTER_HOURS, checkAlerts } from "./drift";
import { withLock } from "./lock";
import { channels, notify } from "./notify";
import { parseRepo, providers } from "./providers";
import type { ProviderId } from "./providers/types";
import { registries, type RegistryId } from "./registries";
import { scanRepo } from "./resolve";
import { matrix } from "./sync";
import { startPoller, syncAndCheck } from "./watch";

const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.RW_HOST ?? "0.0.0.0";
const DIST = resolve(import.meta.dir, "..", "dist"); // independent of the working directory

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const getSource = (id: number) => db.query<Source, [number]>("SELECT * FROM sources WHERE id = ?").get(id);
const getPackage = (id: number) => db.query<Package, [number]>("SELECT * FROM packages WHERE id = ?").get(id);

// ---------- input hygiene ----------
async function body(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}
const id = (req: any) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- view model ----------
function summary(s: Source) {
  const { packages, rows } = matrix(s.id);
  // newest stable git release by date — in grouped (monorepo) mode rows are ordered by
  // package name first, so "first row" would be the alphabetically-first package
  const stable = rows.filter((r) => !r.prerelease && r.git.status === "published");
  const latest = stable.reduce<(typeof rows)[number] | undefined>(
    (best, r) => (!best || (r.git.published_at ?? "") > (best.git.published_at ?? "") ? r : best),
    undefined,
  );
  return {
    ...s,
    packages,
    latest: latest?.version ?? null,
    latest_at: latest?.git.published_at ?? null,
    // per package: is that package's own newest stable release on its registry?
    coverage: packages.map((p) => {
      const mine = rows.filter((r) => r.packages[p.id]?.status !== undefined &&
        (!packages.some((x) => x.tag_prefix) || r.version.startsWith(`${p.name}@`)));
      const top = mine.find((r) => !r.prerelease && r.git.status === "published");
      const c = top?.packages[p.id];
      return { package_id: p.id, registry: p.registry, name: p.name, status: c?.status ?? "missing", lag_hours: c?.lag_hours ?? null };
    }),
  };
}

async function addPackages(sourceId: number) {
  const s = getSource(sourceId)!;
  const ref = { provider: s.provider as ProviderId, host: s.host, path: s.path };
  const found = await scanRepo(providers[ref.provider], ref, s.default_ref ?? "HEAD");
  const ins = db.prepare(
    `INSERT OR IGNORE INTO packages (source_id, registry, name, resolved_by, manifest_path, tag_prefix)
     VALUES (?, ?, ?, 'manifest', ?, ?)`,
  );
  for (const c of found) ins.run(sourceId, c.registry, c.name, c.manifest_path, c.tag_prefix);
  reindex(sourceId);
  return found;
}

const routes: Record<string, any> = {
  "/api/registries": () => json(Object.values(registries).map(({ id, label }) => ({ id, label }))),

  "/api/drift": () => {
    const order = { overdue: 0, yanked: 1, pending: 2, ok: 3 } as const;
    const items = allDrift().sort((a, b) =>
      (+a.muted - +b.muted) || order[a.state] - order[b.state] || (b.hours ?? 1e9) - (a.hours ?? 1e9));
    return json(items);
  },

  "/api/settings": () =>
    json({
      channels: channels(),
      alert_after_hours: ALERT_AFTER_HOURS(),
      poll_minutes: Number(process.env.RW_POLL_MINUTES ?? 60),
      public_url: process.env.RW_PUBLIC_URL ?? null,
    }),

  "/api/notify/test": {
    async POST() {
      const c = channels();
      if (!c.ntfy && !c.webhook) return fail("no channel configured — set RW_NTFY_URL or RW_WEBHOOK_URL");
      const n = await notify({ title: "release-watcher test", body: "Notifications are working.", tags: ["bell"], priority: 3 });
      return n ? json({ ok: true, delivered: n }) : fail("delivery failed — check server log", 502);
    },
  },

  "/api/sources": {
    GET(req: Request) {
      const q = str(new URL(req.url).searchParams.get("q"), 200);
      const terms = q.split(/\s+/).map((t) => t.replace(/["*^:()]/g, "")).filter(Boolean);
      const list = terms.length
        ? db.query<Source, [string]>(
            `SELECT s.* FROM search JOIN sources s ON s.id = search.source_id WHERE search MATCH ? ORDER BY rank`,
          ).all(terms.map((t) => `"${t}"*`).join(" "))
        : db.query<Source, []>("SELECT * FROM sources").all();
      const out = list.map(summary);
      // stable order: newest release first, never-released last (search keeps relevance order)
      if (!terms.length) out.sort((a, b) => (b.latest_at ?? "").localeCompare(a.latest_at ?? "") || a.path.localeCompare(b.path));
      return json(out);
    },
    async POST(req: Request) {
      const b = await body(req);
      const url = str(b.url, 500);
      if (!url) return fail("url is required");
      if (b.track_from && !isDate(b.track_from)) return fail("track_from must be YYYY-MM-DD");
      if (b.provider && !(b.provider in providers)) return fail("provider must be github, gitlab or gitea");
      try {
        const ref = await parseRepo(url, b.provider || undefined);
        const info = await providers[ref.provider].info(ref);
        // canonical path from the host (fixes case: "Owner/Repo" vs "owner/repo" are one source)
        let path = ref.path;
        try {
          const u = new URL(info.url);
          if (u.host.toLowerCase() === ref.host) path = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ""));
        } catch {}
        const row = db.query<{ id: number }, any[]>(
          `INSERT INTO sources (provider, host, path, url, default_ref, track_from) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (host, path) DO UPDATE SET url = excluded.url, default_ref = excluded.default_ref,
             track_from = COALESCE(excluded.track_from, sources.track_from)
           RETURNING id`,
        ).get(ref.provider, ref.host, path, info.url, info.default_ref, b.track_from || null)!;
        const candidates = await withLock(row.id, () => addPackages(row.id)).catch(() => []);
        await syncAndCheck(row.id);
        return json({ source: summary(getSource(row.id)!), candidates }, 201);
      } catch (e: any) {
        return fail(e.message);
      }
    },
  },

  "/api/sources/:id": {
    GET(req: any) {
      const s = getSource(id(req) ?? 0);
      return s ? json({ source: summary(s), ...matrix(s.id) }) : fail("not found", 404);
    },
    async PATCH(req: any) {
      const sid = id(req);
      if (!sid || !getSource(sid)) return fail("not found", 404);
      const b = await body(req);
      if (b.track_from && !isDate(b.track_from)) return fail("track_from must be YYYY-MM-DD");
      await withLock(sid, async () => {
        db.run("UPDATE sources SET track_from = ? WHERE id = ?", [b.track_from || null, sid]);
        // track_from only filters inserts, so drop rows older than the new cut-off
        if (b.track_from) db.run("DELETE FROM releases WHERE source_id = ? AND published_at < ?", [sid, b.track_from]);
      });
      await syncAndCheck(sid);
      return json(summary(getSource(sid)!));
    },
    async DELETE(req: any) {
      const sid = id(req);
      if (!sid) return fail("not found", 404);
      await withLock(sid, async () => {
        db.run("DELETE FROM search WHERE source_id = ?", [sid]);
        db.run("DELETE FROM sources WHERE id = ?", [sid]);
      });
      return json({ ok: true });
    },
  },

  "/api/sources/:id/sync": {
    async POST(req: any) {
      const sid = id(req);
      if (!sid || !getSource(sid)) return fail("not found", 404);
      await syncAndCheck(sid);
      return json(summary(getSource(sid)!));
    },
  },

  "/api/sources/:id/rescan": {
    async POST(req: any) {
      const sid = id(req);
      if (!sid || !getSource(sid)) return fail("not found", 404);
      try {
        const found = await withLock(sid, () => addPackages(sid));
        await syncAndCheck(sid); // newly found packages get data straight away
        return json(found);
      } catch (e: any) {
        return fail(e.message);
      }
    },
  },

  "/api/sources/:id/packages": {
    async POST(req: any) {
      const sid = id(req);
      if (!sid || !getSource(sid)) return fail("not found", 404);
      const b = await body(req);
      const registry = str(b.registry, 20);
      const name = str(b.name, 214);
      const prefix = str(b.tag_prefix, 100) || null;
      if (!(registry in registries) || !name) return fail("registry and name required");
      if (registry === "jsr" && !/^@[\w.-]+\/[\w.-]+$/.test(name)) return fail("JSR names look like @scope/name");
      try {
        await registries[registry as RegistryId].versions(name); // validate it exists
      } catch (e: any) {
        return e?.status === 404 ? fail(`${name} not found on ${registry}`, 404) : fail(`${registry}: ${e.message}`, 502);
      }
      db.run(
        `INSERT OR IGNORE INTO packages (source_id, registry, name, resolved_by, tag_prefix) VALUES (?, ?, ?, 'manual', ?)`,
        [sid, registry, name, prefix],
      );
      await syncAndCheck(sid);
      return json(summary(getSource(sid)!), 201);
    },
  },

  "/api/packages/:id": {
    async PATCH(req: any) {
      const p = getPackage(id(req) ?? 0);
      if (!p) return fail("not found", 404);
      const b = await body(req);
      await withLock(p.source_id, async () => {
        if ("tag_prefix" in b) db.run("UPDATE packages SET tag_prefix = ? WHERE id = ?", [str(b.tag_prefix, 100) || null, p.id]);
        if ("muted" in b) {
          db.run("UPDATE packages SET muted = ? WHERE id = ?", [b.muted ? 1 : 0, p.id]);
          // muting closes any open alert silently
          if (b.muted) db.run("UPDATE alerts SET resolved_at = datetime('now') WHERE package_id = ? AND resolved_at IS NULL", [p.id]);
        }
        // a prefix change re-groups tags; re-evaluate alerts now rather than at the next tick
        await checkAlerts(p.source_id);
      });
      return json({ ok: true });
    },
    async DELETE(req: any) {
      const p = getPackage(id(req) ?? 0);
      if (!p) return fail("not found", 404);
      await withLock(p.source_id, async () => {
        db.run("DELETE FROM packages WHERE id = ?", [p.id]);
        reindex(p.source_id);
      });
      return json({ ok: true });
    },
  },
};

Bun.serve({
  port: PORT,
  hostname: HOST,
  routes,
  async fetch(req) {
    // production: serve the built Svelte app, never anything outside dist/
    let path: string;
    try { path = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response("bad request", { status: 400 }); }
    if (path.startsWith("/api/")) return fail("not found", 404);
    const target = normalize(join(DIST, path === "/" ? "index.html" : path));
    if (target !== DIST && !target.startsWith(DIST + sep)) return new Response("forbidden", { status: 403 });
    const file = Bun.file(target);
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(DIST, "index.html")));
  },
  error(e) {
    console.error("[ERR]", e);
    return fail("internal error", 500);
  },
});

startPoller();
console.log(`[OK] release-watcher on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
