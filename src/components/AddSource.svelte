<script lang="ts">
  import { api, type Source } from "../lib/api";

  let { onadded }: { onadded: (s: Source) => void } = $props();

  let url = $state("");
  let trackFrom = $state("");
  let provider = $state("");
  let busy = $state(false);
  let msg = $state<{ cls: string; text: string } | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!url.trim()) return;
    busy = true;
    msg = { cls: "info", text: "resolving repo, scanning manifests, fetching releases…" };
    try {
      const r = await api.add(url.trim(), trackFrom || undefined, provider || undefined);
      const n = r.source.packages.length;
      msg = n
        ? { cls: "ok", text: `${r.source.path} — resolved ${n} package${n > 1 ? "s" : ""} from manifests` }
        : { cls: "warn", text: `${r.source.path} — no publishable manifest found; add package names manually` };
      url = "";
      onadded(r.source);
    } catch (err: any) {
      msg = { cls: "err", text: err.message };
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  <input class="url" placeholder="https://github.com/owner/repo · gitlab · codeberg · self-hosted" bind:value={url} disabled={busy} />
  <select bind:value={provider} title="Git provider (auto-detected)" disabled={busy}>
    <option value="">auto</option>
    <option value="github">github</option>
    <option value="gitlab">gitlab</option>
    <option value="gitea">gitea / forgejo</option>
  </select>
  <label class="from" title="Ignore releases published before this date">
    <span class="dim">from</span>
    <input type="date" bind:value={trackFrom} disabled={busy} />
  </label>
  <button class="primary" disabled={busy || !url.trim()}>{busy ? "watching…" : "+ watch"}</button>
</form>
{#if msg}
  <p class="msg"><span class="tag {msg.cls}">[{msg.cls.toUpperCase()}]</span> {msg.text}</p>
{/if}

<style>
  form { display: flex; gap: 8px; padding: 14px 24px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
  .url { flex: 1 1 360px; }
  .from { display: flex; align-items: center; gap: 8px; }
  .msg { margin: 0; padding: 8px 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
  @media (max-width: 860px) { form, .msg { padding-left: 16px; padding-right: 16px; } }
</style>
