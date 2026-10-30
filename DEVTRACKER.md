# DEVTRACKER — release-watcher

## Status: v0.3.0 polish & hardening — 2026-10-29

Scope is frozen at "release tracker": git releases vs registry availability, drift, alerts. See CHANGELOG for 0.3.

### Done
- [x] SQLite schema: sources, packages, releases, fts5 search
- [x] Git providers: GitHub (+GHE), GitLab (any host), Gitea/Forgejo/Codeberg; releases with tag fallback
- [x] Self-hosted provider auto-detect (probe `/api/v1/version`, `/api/v4`)
- [x] Registries: npm, JSR, crates.io, PyPI
- [x] Manifest scan → package names (root + one level of workspace members, monorepo tag-prefix guess)
- [x] Manual package add (validated against registry), editable tag prefix
- [x] Version normalisation (`v`, `name@`, `name-v`, `release-`) + matrix with lag
- [x] Track-from date per source
- [x] Background poller, manual sync / rescan
- [x] UI: list + search (`/`), detail matrix, prerelease toggle
- [x] Unit tests: normalise, compare, manifest parse
- [x] **v0.2** Drift view across all sources (overdue / in grace / yanked / ok, registry-at, tag→publish lag)
- [x] **v0.2** Alerts: ntfy + JSON webhook, once per (package, version, kind), "landed" follow-up, silent supersede
- [x] **v0.2** Per-package mute; grace window `RW_ALERT_AFTER_HOURS`; `RW_PUBLIC_URL` click-through
- [x] **v0.2** Poller re-checks pending→overdue every 5 min without network calls
- [x] Tests: 23 passing (adds drift states + alert dedupe/recovery/supersede/mute/no-channel)
- [x] **v0.3** All audit flaws fixed (see CHANGELOG 0.3.0, ADR-0003); 54 tests passing; `tsc --noEmit` clean

### Verified
- npm / crates / PyPI adapters live against real data.
- Matrix verified with seeded git tags (single crate + `svelte@` monorepo).
- Drift end-to-end against live crates/npm/PyPI + seeded tags, alerts captured by a mock ntfy: overdue fired once, deduped on re-sync, "landed" sent after publish, test endpoint delivered.
- [ ] Real ntfy.sh / self-hosted ntfy delivery (headers are standard; not hit from sandbox)
- v0.3 e2e: v0.2 database migrated (8 → 4 git rows), alerts fire once, validation/traversal rejected, no console errors.

### Not yet verified
- [ ] Git provider adapters against live APIs (build sandbox had no access to git hosts) — **test first**
- [ ] JSR adapter live (DNS blocked in sandbox)
- [ ] Self-hosted Forgejo detection against the homelab instance

## Known gaps / risks
- **Pagination:** only the newest page (100 releases / 100 crates versions). Older rows are frozen as last seen (ADR-0003); `track_from` hides this in practice.
- **PEP 440 vs semver spelling:** `1.0.0rc1` (PyPI) and `v1.0.0-rc.1` (git) are both detected as pre-releases but don't match each other. Stable versions match fine.
- **npm "yanked"** is mapped to `deprecated`.
- **Monorepo heuristic:** auto prefix is `name@`; release-please repos (`name-v`) need a one-off inline edit.
- **Workspace globs:** `dir/*` and explicit members only; `**` and negations are skipped.
- **GitHub tag fallback** costs one call per tag (capped at 30) for commit dates.
- **No auth by design.** Bind with `RW_HOST=127.0.0.1` or put it behind a reverse proxy with auth if it leaves the LAN — the server makes outbound requests to whatever hosts are added.

## Next (in scope only)
- [ ] Verify git adapters against live GitHub / GitLab / Forgejo (first real run)
- [ ] Pagination for git releases + crates (removes the frozen-window caveat)
- [ ] Canonicalise PEP 440 pre-releases to match semver tags
