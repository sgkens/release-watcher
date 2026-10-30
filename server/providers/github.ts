import { getJSON, getText, tokenFor } from "../http";
import type { GitProvider, GitRelease, RepoRef } from "./types";

const api = (host: string) => (host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`);
const auth = (host: string): Record<string, string> => {
  const t = tokenFor(host);
  return t ? { authorization: `Bearer ${t}` } : {};
};

export const github: GitProvider = {
  id: "github",

  async info({ host, path }) {
    const r = await getJSON(`${api(host)}/repos/${path}`, auth(host));
    return { default_ref: r.default_branch, url: r.html_url };
  },

  async releases({ host, path }) {
    const rel = await getJSON<any[]>(`${api(host)}/repos/${path}/releases?per_page=100`, auth(host));
    const out: GitRelease[] = rel
      .filter((r) => !r.draft)
      .map((r) => ({ tag: r.tag_name, published_at: r.published_at, url: r.html_url, prerelease: r.prerelease, dated_by: "release" as const }));
    if (out.length) return out;

    // No releases: fall back to tags. Tag dates cost one commit call each, so cap it.
    const tags = await getJSON<any[]>(`${api(host)}/repos/${path}/tags?per_page=30`, auth(host));
    return Promise.all(
      tags.map(async (t) => {
        let date: string | null = null;
        try {
          const c = await getJSON(t.commit.url, auth(host));
          date = c.commit?.committer?.date ?? null;
        } catch {}
        return { tag: t.name, published_at: date, url: `https://${host}/${path}/tree/${t.name}`, prerelease: false, dated_by: "commit" as const };
      }),
    );
  },

  async raw({ host, path }, file, ref) {
    const url = host === "github.com"
      ? `https://raw.githubusercontent.com/${path}/${ref}/${file}`
      : `https://${host}/${path}/raw/${ref}/${file}`;
    return getText(url, auth(host));
  },

  async tree({ host, path }, ref, dir = "") {
    const items = await getJSON<any[]>(`${api(host)}/repos/${path}/contents/${dir}?ref=${ref}`, auth(host));
    return items.map((i) => i.path);
  },
};
