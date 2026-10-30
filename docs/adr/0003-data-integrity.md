# ADR-0003 — Data integrity rules for sync and matching

- Status: accepted
- Date: 2026-10-29

## Context
The v0.2 audit found that stored data could drift from upstream (duplicates, rows that never disappear) and that matching rules mis-attributed tags. Drift alerts are only as good as these rules.

## Decisions
1. **Uniqueness.** Git rows (`package_id IS NULL`) are unique on `(source_id, raw)` via a partial index; registry rows on `(source_id, origin, package_id, raw)`. Never rely on `UNIQUE` across a nullable column.
2. **Pruning by window.** After a successful fetch, rows not returned are deleted only if they are at least as new as the oldest item returned. APIs return the newest page; anything older is outside what we can see and is kept. An empty response prunes nothing.
3. **Pre-release is a property of the normalised version** (plus the host's own flag), never of the tag name.
4. **Tag ownership.** Lockstep mode when no package has a prefix (one row per version, shared). Once any package has a prefix, each package owns: its prefix's tags, or — if it has none — the tags no prefix claims.
5. **Drift clock.** Starts at the release date; for tag-fallback rows dated by commit, at `max(commit date, first seen)`. The matrix still displays the real commit date.
6. **Alerts follow state.** An alert is the persisted shadow of a drift item: opened when it appears, resolved when it clears (after a successful "landed" delivery if one is due), reopened if the same item reappears.
7. **Concurrency.** All writes for one source go through a per-source promise chain (`lock.ts`).

## Consequences
- Releases older than the first API page are frozen as last seen — `track_from` keeps that window irrelevant for most use.
- A flaky upstream that briefly omits a version could cause one extra overdue/landed pair; acceptable versus silent misses.
