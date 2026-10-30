import { beforeEach, describe, expect, test } from "bun:test";

process.env.RW_DB = ":memory:";
process.env.RW_ALERT_AFTER_HOURS = "24";
const { db } = await import("./db");
const { checkAlerts, driftFor } = await import("./drift");
import type { Notice } from "./notify";

const NOW = Date.parse("2026-10-29T00:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 36e5).toISOString();

let src: number, pkg: number;
const source = () => db.query<any, [number]>("SELECT * FROM sources WHERE id = ?").get(src)!;
const tag = (v: string, h: number) =>
  db.run("INSERT INTO releases (source_id, package_id, origin, version, raw, published_at) VALUES (?, NULL, 'git', ?, ?, ?)",
    [src, v, `v${v}`, hoursAgo(h)]);
const publish = (v: string, h: number, yanked = 0) =>
  db.run("INSERT INTO releases (source_id, package_id, origin, version, raw, published_at, yanked) VALUES (?, ?, 'npm', ?, ?, ?, ?)",
    [src, pkg, v, v, hoursAgo(h), yanked]);

function sink() {
  const sent: Notice[] = [];
  return { sent, send: async (n: Notice) => (sent.push(n), 1) };
}

beforeEach(() => {
  db.exec("DELETE FROM alerts; DELETE FROM releases; DELETE FROM packages; DELETE FROM sources;");
  src = (db.query("INSERT INTO sources (provider, host, path, url) VALUES ('github','github.com','me/lib','x') RETURNING id").get() as any).id;
  pkg = (db.query("INSERT INTO packages (source_id, registry, name, resolved_by) VALUES (?, 'npm', 'lib', 'manifest') RETURNING id").get(src) as any).id;
});

describe("driftFor", () => {
  test("ok when latest tag is published", () => {
    tag("1.0.0", 50); publish("1.0.0", 48);
    const [d] = driftFor(source(), NOW);
    expect(d.state).toBe("ok");
    expect(d.lag_hours).toBe(2);
  });

  test("pending inside the grace window, overdue after", () => {
    tag("1.0.0", 100); publish("1.0.0", 99);
    tag("1.1.0", 5);
    expect(driftFor(source(), NOW)[0]).toMatchObject({ state: "pending", version: "1.1.0", registry_latest: "1.0.0" });
    db.run("UPDATE releases SET published_at = ? WHERE raw = 'v1.1.0'", [hoursAgo(30)]);
    expect(driftFor(source(), NOW)[0].state).toBe("overdue");
  });

  test("prereleases don't count as latest", () => {
    tag("1.0.0", 100); publish("1.0.0", 99);
    tag("2.0.0-rc.1", 30);
    expect(driftFor(source(), NOW)[0]).toMatchObject({ state: "ok", version: "1.0.0" });
  });

  test("yanked latest is flagged", () => {
    tag("1.0.0", 100); publish("1.0.0", 99, 1);
    expect(driftFor(source(), NOW)[0].state).toBe("yanked");
  });
});

describe("checkAlerts", () => {
  test("notifies once, then a 'landed' follow-up when it publishes", async () => {
    tag("1.0.0", 30);
    const s = sink();
    expect((await checkAlerts(src, s.send, NOW)).notified).toBe(1);
    expect((await checkAlerts(src, s.send, NOW)).notified).toBe(0); // deduped
    expect(s.sent[0].title).toContain("not on npm");

    publish("1.0.0", 1);
    const r = await checkAlerts(src, s.send, NOW);
    expect(r.resolved).toBe(1);
    expect(s.sent.at(-1)!.title).toContain("landed on npm");
    expect(s.sent).toHaveLength(2);
  });

  test("pending never notifies", async () => {
    tag("1.0.0", 3);
    const s = sink();
    await checkAlerts(src, s.send, NOW);
    expect(s.sent).toHaveLength(0);
  });

  test("superseded alert resolves silently", async () => {
    tag("1.0.0", 30);
    const s = sink();
    await checkAlerts(src, s.send, NOW);
    tag("1.0.1", 2); // newer tag, still pending; 1.0.0 never published
    await checkAlerts(src, s.send, NOW);
    expect(s.sent).toHaveLength(1);
  });

  test("muted packages never notify", async () => {
    db.run("UPDATE packages SET muted = 1 WHERE id = ?", [pkg]);
    tag("1.0.0", 30);
    const s = sink();
    await checkAlerts(src, s.send, NOW);
    expect(s.sent).toHaveLength(0);
  });

  test("no channel configured -> not marked notified, retried later", async () => {
    tag("1.0.0", 30);
    await checkAlerts(src, async () => 0, NOW);
    const s = sink();
    await checkAlerts(src, s.send, NOW);
    expect(s.sent).toHaveLength(1);
  });
});
