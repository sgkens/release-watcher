# release-watcher

Self-hosted tracker that stacks a repo's **git releases** against the same versions on **package registries**, so you can see at a glance whether `v1.4.0` actually landed on npm, JSR, crates.io and PyPI — and how long it took.

Bun · Svelte 5 · SQLite (`bun:sqlite`) · no login.

```
version   git              crates ripgrep
15.0.0    [OK] 2026-10-20  [OK]   2026-10-20  +6h
14.1.1    [OK] 2024-09-08  [OK]   2024-09-09  +7h
14.0.3    no tag           [WARN] 2023-11-28        <- on registry, never tagged
```

## Run

```sh
bun install
bun run dev        # API on :4317, Vite UI on :5173 (proxied)
# or
bun run build && bun start   # single process on :4317
```

Docker: `docker build -t release-watcher . && docker run -p 4317:4317 -v rw-data:/app/data release-watcher`

## How it works

1. **Add a source** — any repo URL: GitHub, GitLab (any host), Gitea / Forgejo / Codeberg. `owner/repo` alone means GitHub. Self-hosted hosts are auto-detected by probing their API.
2. **Resolve packages** — the repo's manifests are read at the default branch:
   | manifest | registry |
   |---|---|
   | `package.json` (non-private) | npm |
   | `jsr.json` / `deno.json(c)` with `@scope/name` | JSR |
   | `Cargo.toml` (`publish != false`) | crates.io |
   | `pyproject.toml` (PEP 621 / Poetry) | PyPI |

   Workspace members (`workspaces`, `[workspace] members`, deno `workspace`) are expanded one level. In multi-package repos a tag prefix (`name@`) is guessed per package.
3. **Manual fallback** — if nothing resolves (or the name differs), add `registry + name (+ tag prefix)` in the UI. Names are validated against the registry before saving.
4. **Sync** — releases from git (falling back to tags if the repo has no releases) and every version from each registry are upserted into SQLite. A poller re-syncs every `RW_POLL_MINUTES`.
5. **Matrix** — versions are normalised (`v1.2.3`, `pkg@1.2.3`, `pkg-v1.2.3` → `1.2.3`) and lined up. Each cell: `[OK]`, `--` missing, `[WARN]` on registry without a git release, `[YANK]`; plus lag (registry publish − git release).

**Track from** — set a date per source to ignore older history.

## Drift & alerts

The **drift** tab answers "what's missing right now?" across every source. For each package it takes the newest stable git release (per tag prefix in monorepos) and checks its registry:

| state | meaning |
|---|---|
| `[ERR]` overdue | not published `RW_ALERT_AFTER_HOURS` (default 24h) after the tag |
| `[WAIT]` in grace | not published yet, still inside the window |
| `[YANK]` | latest release is yanked / deprecated |
| `[OK]` | published — shows tag→publish lag |

Overdue and yanked items send one notification each (ntfy and/or a JSON webhook), and a follow-up when that version lands. Newer tags superseding an old gap resolve silently. **Mute** a package (drift tab or the package chip) to keep it visible without alerts — useful for registries a project lags on purpose.

```sh
RW_NTFY_URL=https://ntfy.sh/my-releases RW_PUBLIC_URL=http://rw.home.lan bun start
```

Use **send test** in the drift tab to check delivery.

## Config

See `.env.example`. Per-host tokens are optional (`RW_TOKEN_GITHUB_COM`, `RW_TOKEN_GITLAB_COM`, `RW_TOKEN_<HOST>`), but unauthenticated GitHub is 60 req/h — set one if you watch more than a handful of repos.

## Security

There is no login, by design. Keep it on your LAN (`RW_HOST=127.0.0.1` behind a reverse proxy, or a firewalled host). Anyone who can reach it can add sources, which makes the server fetch from those hosts.

## Layout

```
server/
  index.ts          Bun.serve routes + static dist
  db.ts             schema (sources, packages, releases, fts5 search)
  sync.ts           sync + matrix builder
  drift.ts          drift computation + alert open/notify/resolve
  notify.ts         ntfy + webhook channels
  watch.ts          sync→check pipeline + poller
  lock.ts           per-source serialisation
  http.ts           fetch with timeouts + readable rate-limit errors
  resolve.ts        manifest scanning → package candidates
  version.ts        tag/version normalisation + compare
  providers/        github · gitlab · gitea (forgejo/codeberg)
  registries/       npm · jsr · crates · pypi
src/
  App.svelte        shell, search (`/` to focus), routing (#/s/:id)
  components/       AddSource · SourceList · SourceDetail · PackageEditor · Matrix · DriftView
docs/adr/           decisions (architecture, drift & alerts, data integrity)
DEVTRACKER.md       status + gaps
CHANGELOG.md
```

## API

| method | path | |
|---|---|---|
| GET | `/api/sources?q=` | list / FTS search |
| POST | `/api/sources` | `{url, provider?, track_from?}` — add, scan, sync |
| GET | `/api/sources/:id` | source + matrix |
| PATCH | `/api/sources/:id` | `{track_from}` |
| DELETE | `/api/sources/:id` | |
| POST | `/api/sources/:id/sync` · `/rescan` | |
| POST | `/api/sources/:id/packages` | `{registry, name, tag_prefix?}` |
| PATCH / DELETE | `/api/packages/:id` | `{tag_prefix?, muted?}` |
| GET | `/api/drift` | drift across all sources |
| GET | `/api/settings` | channels, grace window, poll interval |
| POST | `/api/notify/test` | send a test notification |

Author: Garvey K Snow
