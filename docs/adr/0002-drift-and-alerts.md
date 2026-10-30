# ADR-0002 — Drift view and alerts

- Status: accepted
- Date: 2026-10-29

## Context
The matrix answers "where did version X land?" for one repo. The question that actually needs attention is the reverse, across every repo: *which latest releases haven't reached a registry?* — and to be told without opening the app.

## Decision
- **Drift is per package, not per source.** For each package, take its newest *stable* git release (respecting tag prefixes in monorepos) and look up that version on the package's registry. Prereleases are excluded by both the stored flag and the version string.
- **States:** `ok` (published), `pending` (missing, tag younger than `RW_ALERT_AFTER_HOURS`, default 24), `overdue` (missing past the grace window, or tag date unknown), `yanked`.
- **Computed on read** from the matrix — no drift table. Only alerts are stored.
- **Alerts table keyed `(package_id, version, kind)`** gives at-most-once delivery per drift. A notice is marked sent only if at least one channel accepted it, so configuring ntfy later delivers what's currently drifting rather than nothing.
- **Recovery:** when an alert clears, a "landed" notice goes out only if (a) the original was delivered and (b) that exact version is now `ok`. A drift superseded by a newer tag resolves silently — the newer tag gets its own alert if it also drifts.
- **Mute is per package.** Muted packages still appear in the drift view (dimmed) but never alert; muting closes open alerts silently. This is the escape hatch for registries a project deliberately lags (e.g. a JSR mirror).
- **Channels:** ntfy (topic URL + optional bearer token; works with self-hosted ntfy) and a generic JSON webhook. Both optional, both env-configured.
- **Timing:** checks run after every sync, and the poller re-runs the (network-free) check over all sources every 5 minutes so `pending` turns `overdue` on time even between syncs.

## Consequences
- A version that was resolved and later disappears again (unpublished/re-yanked) will not re-alert under the same key. Acceptable for now.
- Unknown tag dates count as overdue immediately; first sync of a repo with long-standing gaps alerts once per package. Mute handles intentional gaps.
- Alert history grows one row per drifted version; negligible at homelab scale.
