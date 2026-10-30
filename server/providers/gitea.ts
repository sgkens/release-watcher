// Gitea / Forgejo / Codeberg share the same v1 API.
import { getJSON, getText, tokenFor } from "../http";
import type { GitProvider, GitRelease } from "./types";

const api = (host: string, path: string) => `https://${host}/api/v1/repos/${path}`;
const auth = (host: string): Record<string, string> => {
  const t = tokenFor(host);
  return t ? { authorization: `token ${t}` } : {};
};

export const gitea: GitProvider = {
  id: "gitea",

  async info({ host, path }) {
    const r = await getJSON(api(host, path), auth(host));
    return { default_ref: r.default_branch, url: r.html_url };
  },

  async releases({ host, path }) {
    const rel = await getJSON<any[]>(`${api(host, path)}/releases?limit=50`, auth(host));
    const out: GitRelease[] = rel
      .filter((r) => !r.draft)
      .map((r) => ({ tag: r.tag_name, published_at: r.published_at, url: r.html_url, prerelease: r.prerelease, dated_by: "release" as const }));
    if (out.length) return out;

    const tags = await getJSON<any[]>(`${api(host, path)}/tags?limit=50`, auth(host));
    return tags.map((t) => ({
      tag: t.name,
      published_at: t.commit?.created ?? null,
      url: `https://${host}/${path}/src/tag/${encodeURIComponent(t.name)}`,
      prerelease: false,
      dated_by: "commit" as const,
    }));
  },

  async raw({ host, path }, file, ref) {
    return getText(`${api(host, path)}/raw/${file}?ref=${encodeURIComponent(ref)}`, auth(host));
  },

  async tree({ host, path }, ref, dir = "") {
    const items = await getJSON<any[]>(`${api(host, path)}/contents/${dir}?ref=${ref}`, auth(host));
    return items.map((i) => i.path);
  },
};
