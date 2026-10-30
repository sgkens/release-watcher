<script lang="ts">
  import { api, type Detail } from "../lib/api";
  import { ago, date, safeUrl } from "../lib/format";
  import Matrix from "./Matrix.svelte";
  import PackageEditor from "./PackageEditor.svelte";

  let { id, onchange, onclose }: { id: number; onchange: () => void; onclose: () => void } = $props();

  let d = $state<Detail | null>(null);
  let busy = $state(false);
  let err = $state("");
  let showPre = $state(false);
  let confirming = $state(false);

  async function remove() {
    busy = true;
    try { await api.remove(id); onchange(); onclose(); } catch (e: any) { err = e.message; busy = false; }
  }

  async function load() {
    try { d = await api.get(id); err = ""; } catch (e: any) { err = e.message; }
  }
  load();

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    try { await fn(); await load(); onchange(); } catch (e: any) { err = e.message; } finally { busy = false; }
  }

  const rows = $derived(d ? d.rows.filter((r) => showPre || !r.prerelease) : []);
</script>

<section>
  {#if !d}
    <p class="pad dim">{err || "loading…"}</p>
  {:else}
    {@const s = d.source}
    <div class="head">
      <div>
        <h1><a href={safeUrl(s.url)} target="_blank" rel="noreferrer noopener">{s.path}</a></h1>
        <p class="meta dim">
          {s.provider} · {s.host} · ref {s.default_ref ?? "?"} · synced {ago(s.last_synced)}
        </p>
      </div>
      <div class="actions">
        <button disabled={busy} onclick={() => run(() => api.sync(id))}>{busy ? "…" : "↻ sync"}</button>
        <button disabled={busy} onclick={() => run(() => api.rescan(id))} title="Re-read manifests from the repo">scan manifests</button>
        {#if confirming}
          <span class="confirm">stop watching?
            <button class="danger" disabled={busy} onclick={remove}>yes, remove</button>
            <button class="ghost" onclick={() => (confirming = false)}>keep</button>
          </span>
        {:else}
          <button class="ghost" onclick={() => (confirming = true)}>remove</button>
        {/if}
        <button class="ghost" onclick={onclose} aria-label="close">✕</button>
      </div>
    </div>

    {#if s.last_error}
      <pre class="error"><span class="tag err">[ERR]</span> {s.last_error}</pre>
    {/if}
    {#if err}<p class="pad"><span class="tag err">[ERR]</span> {err}</p>{/if}

    <div class="bar">
      <label>
        <span class="dim">track from</span>
        <input type="date" value={s.track_from ?? ""}
          onchange={(e) => run(() => api.update(id, (e.currentTarget as HTMLInputElement).value || null))} />
      </label>
      <label class="check"><input type="checkbox" bind:checked={showPre} /> prereleases</label>
      <span class="faint">{rows.length} versions{s.track_from ? ` since ${date(s.track_from)}` : ""}</span>
    </div>

    <PackageEditor sourceId={id} packages={d.packages} {busy} {run} />
    <Matrix packages={d.packages} {rows} />
  {/if}
</section>

<style>
  section { min-width: 0; }
  .pad { padding: 24px; }
  .head { display: flex; justify-content: space-between; gap: 16px; padding: 20px 24px 14px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
  .meta { margin: 4px 0 0; font-size: 12px; }
  .actions { display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap; }
  .bar { display: flex; gap: 20px; align-items: center; padding: 10px 24px; border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
  .bar label { display: flex; align-items: center; gap: 8px; }
  .check { cursor: pointer; }
  .confirm { display: inline-flex; gap: 6px; align-items: center; color: var(--err); }
  .danger { border-color: var(--err); color: var(--err); }
  .danger:hover:not(:disabled) { background: var(--err); color: var(--bg) !important; border-color: var(--err) !important; }
  .error { margin: 0 24px 14px; padding: 10px 12px; border: 1px solid var(--err); white-space: pre-wrap; font: inherit; }
  @media (max-width: 860px) { .head, .bar { padding-left: 16px; padding-right: 16px; } }
</style>
