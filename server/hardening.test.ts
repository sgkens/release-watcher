// Regression tests for the v0.3 polish/hardening pass. Each block names the flaw it pins down.
import { beforeEach, describe, expect, test } from "bun:test";

process.env.RW_DB = ":memory:";
const { db } = await import("./db");
const { syncSource, matrix } = await import("./sync");
const { driftFor, checkAlerts } = await import("./drift");
const { withLock } = await import("./lock");
const { providers, parseRepo } = await import("./providers");
const { registries } = await import("./registries");
const { scanRepo } = await import("./resolve");
const { compare, isPrerelease, normalise } = await import("./version");
import type { GitRelease, GitProvider } from "./providers/types";
import type { RegistryVersion } from "./registries";
import type { Notice } from "./notify";

// ---- stubs: no network in tests ----
let gitStub: GitRelease[] = [];
let regStub: Record<string, RegistryVersion[]> = {};
providers.github.releases = async () => gitStub;
registries.npm.versions = async (n) => regStub[n] ?? [];
registries.crates.versions = async (n) => regStub[n] ?? [];

const rel = (tag: string, at: string, dated_by: "release" | "commit" = "release"): GitRelease =>
  ({ tag, published_at: at, url: "https://example.test/" + tag, prerelease: false, dated_by });
const ver = (version: string, at: string, yanked = false): RegistryVersion =>
  ({ version, published_at: at, url: "https://example.test/v/" + version, yanked });

let src: number;
const addPkg = (registry: string, name: string, prefix: string | null = null) =>
  (db.query("INSERT INTO packages (source_id, registry, name, resolved_by, tag_prefix) VALUES (?, ?, ?, 'manual', ?) RETURNING id")
    .get(src, registry, name, prefix) as any).id as number;
const gitRows = () => (db.query("SELECT count(*) c FROM releases WHERE package_id IS NULL").get() as any).c;
const source = () => db.query<any, [number]>("SELECT * FROM sources WHERE id = ?").get(src)!;

beforeEach(() => {
  db.exec("DELETE FROM alerts; DELETE FROM releases; DELETE FROM packages; DELETE FROM sources;");
  src = (db.query("INSERT INTO sources (provider, host, path, url) VALUES ('github','github.com','me/lib','x') RETURNING id").get() as any).id;
  gitStub = [];
  regStub = {};
  delete process.env.RW_NTFY_URL;
});

describe("bug: git rows duplicated on every sync (NULL in UNIQUE)", () => {
  test("re-syncing the same releases keeps one row each", async () => {
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z"), rel("v1.1.0", "2026-02-01T00:00:00Z")];
    await syncSource(src);
    await syncSource(src);
    await syncSource(src);
    expect(gitRows()).toBe(2);
  });

  test("changed release date is updated, not duplicated", async () => {
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    gitStub = [rel("v1.0.0", "2026-01-05T00:00:00Z")];
    await syncSource(src);
    const r = db.query("SELECT published_at FROM releases WHERE package_id IS NULL").all() as any[];
    expect(r).toEqual([{ published_at: "2026-01-05T00:00:00Z" }]);
  });
});

describe("hardening: versions removed upstream are pruned (within the fetched window)", () => {
  test("deleted release and unpublished version disappear; older-than-page rows stay", async () => {
    const pkg = addPkg("npm", "lib");
    gitStub = [rel("v0.9.0", "2025-06-01T00:00:00Z"), rel("v1.0.0", "2026-01-01T00:00:00Z"), rel("v1.1.0", "2026-02-01T00:00:00Z")];
    regStub.lib = [ver("1.0.0", "2026-01-01T01:00:00Z"), ver("1.1.0", "2026-02-01T01:00:00Z")];
    await syncSource(src);
    // upstream: 1.1.0 release deleted; API page now only reaches back to 2026-01-01 (0.9.0 off-page)
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    regStub.lib = [ver("1.0.0", "2026-01-01T01:00:00Z")];
    await syncSource(src);
    const raws = (db.query("SELECT raw FROM releases WHERE package_id IS NULL ORDER BY raw").all() as any[]).map((r) => r.raw);
    expect(raws).toEqual(["v0.9.0", "v1.0.0"]);
    expect((db.query("SELECT count(*) c FROM releases WHERE package_id = ?").get(pkg) as any).c).toBe(1);
  });

  test("an empty answer never wipes history", async () => {
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    gitStub = [];
    await syncSource(src);
    expect(gitRows()).toBe(1);
  });
});

describe("bug: prerelease detection ran on raw tag names", () => {
  test.each([
    ["1.2.3", false], ["1.0.0-rc.1", true], ["1.0.0rc1", true], ["1.0.dev6", true],
    ["2.0a1", true], ["1.0.0.post1", false], ["2024.10.01", false],
  ])("isPrerelease(%s) = %s", (v, out) => expect(isPrerelease(v)).toBe(out));

  test("release-please / devtools / release- tags are stable after sync", async () => {
    gitStub = [
      rel("release-1.2.3", "2026-01-01T00:00:00Z"),
      rel("core-v1.2.4", "2026-01-02T00:00:00Z"),
      rel("@vue/devtools@7.0.0", "2026-01-03T00:00:00Z"),
    ];
    await syncSource(src);
    const pre = (db.query("SELECT sum(prerelease) s FROM releases").get() as any).s;
    expect(pre).toBe(0);
  });
});

describe("bug: rc ordering and version compare", () => {
  test("numeric pre-release identifiers", () => {
    expect(["1.0.0-rc.10", "1.0.0-rc.2", "1.0.0", "1.0.0-beta.1"].sort(compare))
      .toEqual(["1.0.0-beta.1", "1.0.0-rc.2", "1.0.0-rc.10", "1.0.0"]);
  });
  test("four-segment versions", () => {
    expect(compare("1.2.3.10", "1.2.3.9")).toBeGreaterThan(0);
  });
  test("build metadata is dropped when normalising", () => {
    expect(normalise("v1.2.3+build.7")).toBe("1.2.3");
  });
});

describe("bug: mixed prefixed / unprefixed packages cross-matched tags", () => {
  test("unprefixed package only owns tags no other prefix claims", async () => {
    const npm = addPkg("npm", "core", "core@");
    const rs = addPkg("crates", "core-rs", null);
    gitStub = [rel("core@2.0.0", "2026-01-01T00:00:00Z"), rel("v0.5.0", "2026-01-01T00:00:00Z")];
    regStub.core = [ver("2.0.0", "2026-01-01T01:00:00Z")];
    regStub["core-rs"] = [ver("0.5.0", "2026-01-01T02:00:00Z")];
    await syncSource(src);
    const keys = matrix(src).rows.map((r) => r.version).sort();
    expect(keys).toEqual(["core-rs@0.5.0", "core@2.0.0"]);
    const d = driftFor(source(), Date.parse("2026-03-01T00:00:00Z"));
    expect(d.find((x) => x.package_id === rs)).toMatchObject({ version: "0.5.0", state: "ok" });
    expect(d.find((x) => x.package_id === npm)).toMatchObject({ version: "2.0.0", state: "ok" });
  });

  test("non-version tags never form rows", async () => {
    gitStub = [rel("nightly", "2026-01-01T00:00:00Z"), rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    expect(matrix(src).rows.map((r) => r.version)).toEqual(["1.0.0"]);
  });
});

describe("hardening: tag-only repos are timed from when the tag appeared", () => {
  test("tag on an old commit is pending, not instantly overdue", async () => {
    addPkg("npm", "lib");
    gitStub = [rel("v2.0.0", "2025-12-01T00:00:00Z", "commit")]; // commit date a month ago
    await syncSource(src); // seen_at = now
    const [d] = driftFor(source(), Date.now());
    expect(d.state).toBe("pending");
    expect(d.tagged_at).toBe("2025-12-01T00:00:00Z"); // display keeps the real commit date
  });

  test("real release dates are still used as-is", async () => {
    addPkg("npm", "lib");
    gitStub = [rel("v2.0.0", "2025-12-01T00:00:00Z", "release")];
    await syncSource(src);
    expect(driftFor(source(), Date.now())[0].state).toBe("overdue");
  });
});

describe("bug: parseRepo truncated nested GitLab paths", () => {
  test.each([
    ["https://gitlab.com/group/sub/project/-/tree/main", "gitlab", "group/sub/project"],
    ["https://github.com/Owner/Repo/tree/main/src", "github", "Owner/Repo"],
    ["git@github.com:owner/repo.git", "github", "owner/repo"],
    ["https://codeberg.org/owner/repo/src/branch/main", "gitea", "owner/repo"],
    ["owner/repo", "github", "owner/repo"],
  ])("%s", async (input, provider, path) => {
    expect(await parseRepo(input)).toMatchObject({ provider, path });
  });

  test("self-hosted GitLab keeps subgroups (provider given, no probe)", async () => {
    expect(await parseRepo("https://Git.Home.LAN/team/tools/rw/-/releases", "gitlab"))
      .toEqual({ provider: "gitlab", host: "git.home.lan", path: "team/tools/rw" });
  });

  test("rejects non-repo input", async () => {
    await expect(parseRepo("https://github.com/onlyowner")).rejects.toThrow();
  });
});

describe("hardening: alerts", () => {
  const slowSink = () => {
    const sent: Notice[] = [];
    return { sent, send: async (n: Notice) => { await Bun.sleep(20); sent.push(n); return 1; } };
  };

  test("concurrent checks through the per-source lock send once", async () => {
    addPkg("npm", "lib");
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    const s = slowSink();
    await Promise.all([1, 2, 3].map(() => withLock(src, () => checkAlerts(src, s.send))));
    expect(s.sent).toHaveLength(1);
  });

  test("a failed 'landed' delivery is retried, not lost", async () => {
    process.env.RW_NTFY_URL = "http://ntfy.invalid/t"; // a channel is configured
    const pkg = addPkg("npm", "lib");
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    const sent: Notice[] = [];
    await checkAlerts(src, async (n) => (sent.push(n), 1)); // overdue delivered
    regStub.lib = [ver("1.0.0", "2026-01-03T00:00:00Z")];
    await syncSource(src);
    const r1 = await checkAlerts(src, async () => 0); // landed delivery fails
    expect(r1.resolved).toBe(0);
    const r2 = await checkAlerts(src, async (n) => (sent.push(n), 1));
    expect(r2.resolved).toBe(1);
    expect(sent.map((n) => n.title)).toEqual(["lib 1.0.0 not on npm", "lib 1.0.0 landed on npm"]);
    expect(pkg).toBeGreaterThan(0);
  });
});

describe("hardening: resolved alerts reopen when the problem returns", () => {
  test("version unpublished after landing alerts again", async () => {
    addPkg("npm", "lib");
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    regStub.lib = [ver("0.9.0", "2025-12-01T00:00:00Z")];
    await syncSource(src);
    const sent: Notice[] = [];
    const send = async (n: Notice) => (sent.push(n), 1);
    await checkAlerts(src, send); // overdue
    regStub.lib = [ver("0.9.0", "2025-12-01T00:00:00Z"), ver("1.0.0", "2026-01-02T00:00:00Z")];
    await syncSource(src);
    await checkAlerts(src, send); // landed
    regStub.lib = [ver("0.9.0", "2025-12-01T00:00:00Z")]; // 1.0.0 unpublished
    await syncSource(src);
    await checkAlerts(src, send); // overdue again
    expect(sent.map((n) => n.title)).toEqual(["lib 1.0.0 not on npm", "lib 1.0.0 landed on npm", "lib 1.0.0 not on npm"]);
  });

  test("unmuting a still-drifting package alerts", async () => {
    const pkg = addPkg("npm", "lib");
    db.run("UPDATE packages SET muted = 1 WHERE id = ?", [pkg]);
    gitStub = [rel("v1.0.0", "2026-01-01T00:00:00Z")];
    await syncSource(src);
    const sent: Notice[] = [];
    await checkAlerts(src, async (n) => (sent.push(n), 1));
    expect(sent).toHaveLength(0);
    db.run("UPDATE packages SET muted = 0 WHERE id = ?", [pkg]);
    await checkAlerts(src, async (n) => (sent.push(n), 1));
    expect(sent).toHaveLength(1);
  });
});

describe("hardening: manifest scan cost", () => {
  test("member folders are listed once; only present manifests are read", async () => {
    const calls: string[] = [];
    const fake: GitProvider = {
      id: "github",
      info: async () => ({ default_ref: "main", url: "" }),
      releases: async () => [],
      tree: async (_r, _g, dir = "") => {
        calls.push(`tree:${dir}`);
        if (!dir) return ["package.json", "packages"];
        if (dir === "packages") return ["packages/a", "packages/b"];
        if (dir === "packages/a") return ["packages/a/package.json", "packages/a/src"];
        if (dir === "packages/b") return ["packages/b/Cargo.toml"];
        return [];
      },
      raw: async (_r, f) => {
        calls.push(`raw:${f}`);
        if (f === "package.json") return JSON.stringify({ name: "root", private: true, workspaces: ["./packages/*/"] });
        if (f === "packages/a/package.json") return JSON.stringify({ name: "@me/a" });
        if (f === "packages/b/Cargo.toml") return `[package]\nname = "b"\n`;
        return null;
      },
    };
    const found = await scanRepo(fake, { provider: "github", host: "github.com", path: "me/mono" }, "main");
    expect(found.map((c) => `${c.registry}:${c.name}:${c.tag_prefix}`).sort()).toEqual(["crates:b:b@", "npm:@me/a:@me/a@"]);
    expect(calls.filter((c) => c.startsWith("raw:"))).toHaveLength(3); // root + one per member
  });
});
