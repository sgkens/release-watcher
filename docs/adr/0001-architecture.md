# ADR-0001 — Architecture: Bun + Svelte + SQLite, single process, no auth

- Status: accepted
- Date: 2026-10-29

## Context
Release Watcher is a self-hosted tool for one person or a small team to see whether git releases reached package registries. It runs on a homelab; scale is tens to low hundreds of sources.

## Decision
- **Runtime:** Bun. `Bun.serve` routes for the API, `bun:sqlite` for storage, `Bun.TOML` for Cargo/pyproject parsing — zero runtime dependencies.
- **UI:** Svelte 5 (runes) built by Vite into `dist/`, served by the same Bun process in production. Hash routing; no SvelteKit (no SSR needed, keeps one process).
- **Storage:** one SQLite file, WAL. Releases from git and registries share one `releases` table keyed by `origin`; the comparison matrix is computed on read, not stored.
- **Adapters:** git providers and registries are plain objects behind small interfaces (`GitProvider`, `Registry`). Adding a registry = one object in `registries/index.ts`.
- **No login.** Bind to LAN / put behind a reverse proxy with auth if exposed.
- **Polling, not webhooks.** Registries don't offer webhooks uniformly; a 60-min poll is enough for this use.

## Consequences
- Matrix is O(releases) per request — fine at this scale; add a cache table if sources get large.
- Unauthenticated GitHub limits (60/h) will bite quickly; tokens are per-host env vars.
- Single-writer SQLite is fine; the poller is sequential on purpose to stay inside rate limits.
