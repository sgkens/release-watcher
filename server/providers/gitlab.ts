import { getJSON, getText, tokenFor } from "../http";
import type { GitProvider, GitRelease } from "./types";

const proj = (host: string, path: string) => `https://${host}/api/v4/projects/${encodeURIComponent(path)}`;
const auth = (host: string): Record<string, string> => {
  const t = tokenFor(host);
  return t ? { "private-token": t } : {};
};

export const gitlab: GitProvider = {
  id: "gitlab",

  async info({ host, path }) {
    const r = await getJSON(proj(host, path), auth(host));
    return { default_ref: r.default_branch, url: r.web_url };
  },

  async releases({ host, path }) {
    const rel = await getJSON<any[]>(`${proj(host, path)}/releases?per_page=100`, auth(host));
    const out: GitRelease[] = rel.map((r) => ({
      tag: r.tag_name,
      published_at: r.released_at ?? r.created_at,
      url: r._links?.self ?? null,
      prerelease: !!r.upcoming_release,
      dated_by: "release" as const,
    }));
    if (out.length) return out;

    // GitLab tags include the commit date inline — no extra calls needed.
    const tags = await getJSON<any[]>(`${proj(host, path)}/repository/tags?per_page=100`, auth(host));
    return tags.map((t) => ({
      tag: t.name,
      // annotated tags carry their own created_at; lightweight tags only have the commit date
      published_at: t.created_at ?? t.commit?.committed_date ?? null,
      url: `https://${host}/${path}/-/tags/${encodeURIComponent(t.name)}`,
      prerelease: false,
      dated_by: t.created_at ? ("release" as const) : ("commit" as const),
    }));
  },

  async raw({ host, path }, file, ref) {
    return getText(
      `${proj(host, path)}/repository/files/${encodeURIComponent(file)}/raw?ref=${encodeURIComponent(ref)}`,
      auth(host),
    );
  },

  async tree({ host, path }, ref, dir = "") {
    const q = dir ? `&path=${encodeURIComponent(dir)}` : "";
    const items = await getJSON<any[]>(`${proj(host, path)}/repository/tree?ref=${ref}&per_page=100${q}`, auth(host));
    return items.map((i) => i.path);
  },
};
