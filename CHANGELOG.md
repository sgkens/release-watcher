# Changelog

## 0.3.0 — 2026-10-29 · polish & hardening

No new features. Fixes and hardening from the v0.2 audit.

### Fixed
- **Git releases duplicated on every sync.** SQLite treats NULLs as distinct in `UNIQUE`, so git rows (no package) were re-inserted each sync. Now a partial unique index; existing duplicates are collapsed on startup.
- **Pre-release detection ran on raw tag names.** `release-1.2.3`, `core-v1.2.3`, `@vue/devtools@7.0.0` were treated as pre-releases (and so ignored by drift). Detection now runs on the normalised version; PEP 440 `rc`/`a`/`b`/`dev` recognised, `.postN` is not a pre-release.
- **Prefixed and unprefixed packages in one repo cross-matched tags**, producing phantom versions and false "overdue". An unprefixed package now only owns tags that no other package's prefix claims.
- **Self-hosted GitLab subgroup URLs were truncated** to two segments before the host was detected.
- **Version ordering:** `rc.10` sorted before `rc.2`; versions with more than three numeric segments compared wrongly. `+build` metadata is dropped when matching.
- **Monorepo card headline** showed the alphabetically-first package's latest instead of the newest release.
- **Alert could be sent twice** when a manual sync and the poller overlapped.
- **"Landed" notice lost** if delivery failed; it is now retried on the next check.
- **Resolved alerts never reopened**: a version unpublished after landing (or a package unmuted while still drifting) showed overdue in the UI but stayed silent.
- Non-version tags (`nightly`, `latest`) no longer appear as matrix rows.

### Hardened
- Every outbound request has a timeout (`RW_HTTP_TIMEOUT_MS`, default 15s); one hung host can no longer stall the poller.
- Rate-limit responses explain themselves (host, reset time, which `RW_TOKEN_*` to set) instead of a bare 403.
- Syncs, alert checks and edits are serialised per source.
- Releases/versions removed upstream are pruned — only inside the window the API actually returned, and never on an empty answer.
- Tag-only repos: the drift clock starts when the tag was first seen, not at the (possibly much older) commit date.
- Manifest scan lists each workspace member once and reads only manifests that exist (was up to 6 blind reads per member). `./packages/*/` style globs normalised.
- Sources are stored under the host's canonical path, so `Owner/Repo` and `owner/repo` are one source; re-adding updates `track_from`.
- API input validation: malformed JSON, dates, ids, JSR name shape, length limits. Internal errors no longer echo messages.
- Static serving resolves `dist/` from the install path and refuses paths outside it. `RW_HOST` sets the bind address.
- Links from git hosts/registries are rendered only if `http(s)`.

### Polish
- Dates shown in the viewer's timezone; full timestamp on hover.
- Inline tag-prefix editing (Enter/Esc) and inline remove confirmation replace browser `prompt()`/`confirm()`.
- "Scan manifests" syncs newly found packages immediately.
- Source list ordered by newest release.

### Tests
54 passing (was 23): regression tests for each fix above, with stubbed providers/registries (no network).

## 0.2.0 — 2026-10-29
- Drift view across all sources; ntfy + webhook alerts with dedupe and "landed" follow-up; per-package mute.

## 0.1.0 — 2026-10-29
- Initial scaffold: sources, manifest resolution, git providers, npm/JSR/crates/PyPI, version matrix, search.
