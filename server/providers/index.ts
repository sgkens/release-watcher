import { github } from "./github";
import { gitlab } from "./gitlab";
import { gitea } from "./gitea";
import { fetchT } from "../http";
import type { GitProvider, ProviderId, RepoRef } from "./types";

export const providers: Record<ProviderId, GitProvider> = { github, gitlab, gitea };

const KNOWN: Record<string, ProviderId> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "gitea",
  "gitea.com": "gitea",
};

/**
 * Accepts https URLs, ssh-ish "git@host:owner/repo.git", or "owner/repo" (GitHub).
 * Self-hosted hosts are probed: Gitea/Forgejo answer /api/v1/version, GitLab answers /api/v4.
 * The path is trimmed only after the provider is known, because GitLab paths can be
 * nested (group/subgroup/project) while GitHub/Gitea are always owner/repo.
 */
export async function parseRepo(input: string, hint?: ProviderId): Promise<RepoRef> {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  let host: string, path: string;

  const ssh = s.match(/^[\w.-]+@([^:/]+):(.+)$/);
  if (ssh) [, host, path] = ssh;
  else if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    host = u.host;
    path = u.pathname.replace(/^\/+/, "");
  } else if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    host = "github.com";
    path = s;
  } else throw new Error(`Can't parse repository: ${input}`);

  host = host.toLowerCase();
  path = path.replace(/\.git$/, "");
  if (hint && !(hint in providers)) throw new Error(`Unknown provider: ${hint}`);
  const provider = hint ?? KNOWN[host] ?? (await probe(host));

  if (provider === "gitlab") {
    path = path.split("/-/")[0]; // strip "/-/tree/main", "/-/releases", ...
  } else {
    path = path.split("/").slice(0, 2).join("/"); // strip "/tree/main", "/src/branch/x", "/releases"
  }
  if (!path || path.split("/").length < 2) throw new Error(`Not a repository path: ${input}`);
  return { provider, host, path };
}

async function probe(host: string): Promise<ProviderId> {
  const json = (r: Response) => (r.headers.get("content-type") ?? "").includes("json");
  const gitea = await fetchT(`https://${host}/api/v1/version`).then((r) => r.ok && json(r)).catch(() => false);
  if (gitea) return "gitea";
  // /api/v4/version needs auth on GitLab, so a JSON 401 is as good a signal as a 200
  const gl = await fetchT(`https://${host}/api/v4/version`)
    .then((r) => (r.ok || r.status === 401) && json(r)).catch(() => false);
  if (gl) return "gitlab";
  throw new Error(`Couldn't detect the git provider for ${host} — pick one explicitly`);
}
