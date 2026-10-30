// Manifest scanning: read package.json / jsr.json / deno.json / Cargo.toml / pyproject.toml
// from the repo (root + one level of declared workspace members) and infer registry package names.
import type { GitProvider, RepoRef } from "./providers/types";
import type { RegistryId } from "./registries";

export type Candidate = {
  registry: RegistryId;
  name: string;
  manifest_path: string;
  tag_prefix: string | null; // guessed for monorepos; user can edit
};

type Reader = (path: string) => Promise<string | null>;

const MAX_MEMBERS = 40;
const MANIFESTS = ["package.json", "jsr.json", "deno.json", "deno.jsonc", "Cargo.toml", "pyproject.toml"];

export async function scanRepo(p: GitProvider, ref: RepoRef, gitRef: string): Promise<Candidate[]> {
  const read: Reader = (f) => p.raw(ref, f, gitRef);
  const root = await p.tree(ref, gitRef);
  const found: Candidate[] = [];
  const memberDirs = new Set<string>();

  for (const file of MANIFESTS.filter((m) => root.includes(m))) {
    const text = await read(file);
    if (!text) continue;
    const { candidates, members } = parse(file, text);
    found.push(...candidates);
    members.forEach((m) => memberDirs.add(m));
  }

  // Expand workspace globs one level ("packages/*", "crates/*").
  const dirs = new Set<string>();
  for (const raw of memberDirs) {
    // "./packages/*", "packages/a/" -> "packages/*", "packages/a"; negations ("!x") are skipped
    const m = raw.trim().replace(/^\.\//, "").replace(/\/+$/, "");
    if (!m || m.startsWith("!") || m.includes("**")) continue;
    if (m.endsWith("/*")) {
      const base = m.slice(0, -2);
      try { (await p.tree(ref, gitRef, base)).forEach((d) => dirs.add(d)); } catch {}
    } else dirs.add(m);
  }

  // One listing per member, then only the manifests that actually exist there:
  // 1 + k requests per member instead of blindly trying all six names (matters on rate-limited hosts).
  const multi = dirs.size > 1;
  for (const dir of [...dirs].slice(0, MAX_MEMBERS)) {
    let present: string[];
    try {
      const names = new Set((await p.tree(ref, gitRef, dir)).map((f) => f.split("/").pop()!));
      present = MANIFESTS.filter((m) => names.has(m));
    } catch {
      continue; // not a directory, or listing failed
    }
    for (const file of present) {
      const path = `${dir}/${file}`;
      const text = await read(path).catch(() => null);
      if (!text) continue;
      for (const c of parse(path, text).candidates) {
        found.push({ ...c, tag_prefix: multi ? `${c.name}@` : null });
      }
    }
  }

  // dedupe
  const seen = new Set<string>();
  return found.filter((c) => {
    const k = `${c.registry}:${c.name}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function parse(path: string, text: string): { candidates: Candidate[]; members: string[] } {
  const file = path.split("/").pop()!;
  const c = (registry: RegistryId, name: string): Candidate => ({ registry, name, manifest_path: path, tag_prefix: null });

  try {
    switch (file) {
      case "package.json": {
        const j = JSON.parse(text);
        const ws = Array.isArray(j.workspaces) ? j.workspaces : j.workspaces?.packages ?? [];
        return { candidates: j.name && !j.private ? [c("npm", j.name)] : [], members: ws };
      }
      case "jsr.json":
      case "deno.json":
      case "deno.jsonc": {
        const j = JSON.parse(stripJsonc(text));
        return { candidates: j.name?.startsWith("@") ? [c("jsr", j.name)] : [], members: j.workspace ?? [] };
      }
      case "Cargo.toml": {
        const t: any = Bun.TOML.parse(text);
        const out = t.package?.name && t.package?.publish !== false ? [c("crates", t.package.name)] : [];
        return { candidates: out, members: t.workspace?.members ?? [] };
      }
      case "pyproject.toml": {
        const t: any = Bun.TOML.parse(text);
        const name = t.project?.name ?? t.tool?.poetry?.name;
        return { candidates: name ? [c("pypi", name)] : [], members: [] };
      }
    }
  } catch {
    /* malformed manifest — ignore, user can add manually */
  }
  return { candidates: [], members: [] };
}

function stripJsonc(s: string) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
}
