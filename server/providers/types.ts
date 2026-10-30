export type GitRelease = {
  tag: string;
  published_at: string | null;
  url: string | null;
  prerelease: boolean;
  /** "release": a real release/tag date. "commit": tag fallback dated by its commit, which can predate the tag. */
  dated_by: "release" | "commit";
};

export type RepoRef = { provider: ProviderId; host: string; path: string };

export type ProviderId = "github" | "gitlab" | "gitea";

export interface GitProvider {
  id: ProviderId;
  /** Repo metadata (default branch). */
  info(ref: RepoRef): Promise<{ default_ref: string; url: string }>;
  /** Releases first; falls back to plain tags when a repo doesn't use releases. */
  releases(ref: RepoRef): Promise<GitRelease[]>;
  /** Raw file at ref, or null if missing. Used for manifest scanning. */
  raw(ref: RepoRef, path: string, gitRef: string): Promise<string | null>;
  /** List root-level paths — used to find manifests without guessing blindly. */
  tree(ref: RepoRef, gitRef: string, dir?: string): Promise<string[]>;
}
