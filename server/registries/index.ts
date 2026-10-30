import { getJSON } from "../http";

export type RegistryId = "npm" | "jsr" | "crates" | "pypi";

export type RegistryVersion = {
  version: string;
  published_at: string | null;
  url: string;
  yanked: boolean;
};

export interface Registry {
  id: RegistryId;
  label: string;
  versions(name: string): Promise<RegistryVersion[]>;
  pageUrl(name: string): string;
}

const npm: Registry = {
  id: "npm",
  label: "npm",
  pageUrl: (n) => `https://www.npmjs.com/package/${n}`,
  async versions(name) {
    const d = await getJSON(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
    return Object.keys(d.versions ?? {}).map((v) => ({
      version: v,
      published_at: d.time?.[v] ?? null,
      url: `https://www.npmjs.com/package/${name}/v/${v}`,
      yanked: !!d.versions[v].deprecated, // npm has no yank; deprecation is the closest signal
    }));
  },
};

const jsr: Registry = {
  id: "jsr",
  label: "JSR",
  pageUrl: (n) => `https://jsr.io/${n}`,
  async versions(name) {
    // name is "@scope/pkg"
    const d = await getJSON(`https://jsr.io/${name}/meta.json`);
    return Object.entries<any>(d.versions ?? {}).map(([v, m]) => ({
      version: v,
      published_at: m.createdAt ?? null,
      url: `https://jsr.io/${name}@${v}`,
      yanked: !!m.yanked,
    }));
  },
};

const crates: Registry = {
  id: "crates",
  label: "crates.io",
  pageUrl: (n) => `https://crates.io/crates/${n}`,
  async versions(name) {
    // crates.io requires a descriptive User-Agent (set in http.ts)
    const d = await getJSON(`https://crates.io/api/v1/crates/${name}/versions?per_page=100`);
    return (d.versions ?? []).map((v: any) => ({
      version: v.num,
      published_at: v.created_at,
      url: `https://crates.io/crates/${name}/${v.num}`,
      yanked: v.yanked,
    }));
  },
};

const pypi: Registry = {
  id: "pypi",
  label: "PyPI",
  pageUrl: (n) => `https://pypi.org/project/${n}/`,
  async versions(name) {
    const d = await getJSON(`https://pypi.org/pypi/${name}/json`);
    return Object.entries<any[]>(d.releases ?? {}).map(([v, files]) => ({
      version: v,
      published_at: files[0]?.upload_time_iso_8601 ?? null,
      url: `https://pypi.org/project/${name}/${v}/`,
      yanked: files.length > 0 && files.every((f) => f.yanked),
    }));
  },
};

export const registries: Record<RegistryId, Registry> = { npm, jsr, crates, pypi };
