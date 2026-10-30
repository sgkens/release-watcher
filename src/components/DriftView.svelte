<script lang="ts">
  import { api, type DriftItem, type Settings } from "../lib/api";
  import { ago, lag, REG_LABEL, safeUrl, stamp } from "../lib/format";

  let { items, onopen, onrefresh }: {
    items: DriftItem[]; onopen: (sourceId: number) => void; onrefresh: () => void;
  } = $props();

  let settings = $state<Settings | null>(null);
  let showOk = $state(false);
  let testMsg = $state<{ cls: string; text: string } | null>(null);

  api.settings().then((s) => (settings = s)).catch(() => {});

  const counts = $derived({
    overdue: items.filter((i) => i.state === "overdue" && !i.muted).length,
    yanked: items.filter((i) => i.state === "yanked" && !i.muted).length,
    pending: items.filter((i) => i.state === "pending" && !i.muted).length,
    ok: items.filter((i) => i.state === "ok").length,
    muted: items.filter((i) => i.muted && i.state !== "ok").length,
  });
  const shown = $derived(items.filter((i) => showOk || i.state !== "ok"));

  const TAG = {
    overdue: { t: "ERR", c: "err" },
    yanked: { t: "YANK", c: "err" },
    pending: { t: "WAIT", c: "warn" },
    ok: { t: "OK", c: "ok" },
  } as const;

  const span = (h: number | null) => (h == null ? "?" : lag(h).replace(/^[+-]/, ""));

  async function test() {
    testMsg = { cls: "info", text: "sending…" };
    try {
      const r = await api.testNotify();
      testMsg = { cls: "ok", text: `delivered to ${r.delivered} channel${r.delivered > 1 ? "s" : ""}` };
    } catch (e: any) {
      testMsg = { cls: "err", text: e.message };
    }
  }

  async function toggleMute(i: DriftItem) {
    await api.setMuted(i.package_id, !i.muted);
    onrefresh();
  }
</script>

<section>
  <div class="head">
    <h1>drift</h1>
    <p class="dim">Latest stable git release of every watched package, checked against its registry.</p>
  </div>

  <div class="stats">
    <div class="stat" class:hot={counts.overdue}><b class="err">{counts.overdue}</b><span>overdue</span></div>
    <div class="stat" class:hot={counts.yanked}><b class="err">{counts.yanked}</b><span>yanked</span></div>
    <div class="stat"><b class="warn">{counts.pending}</b><span>in grace</span></div>
    <div class="stat"><b class="ok">{counts.ok}</b><span>in sync</span></div>
    <div class="stat"><b class="faint">{counts.muted}</b><span>muted</span></div>
  </div>

  <div class="bar">
    {#if settings}
      {#if settings.channels.ntfy || settings.channels.webhook}
        <span><span class="tag ok">[OK]</span> alerts →
          {[settings.channels.ntfy && "ntfy", settings.channels.webhook && "webhook"].filter(Boolean).join(" + ")}
          after {settings.alert_after_hours}h</span>
        <button onclick={test}>send test</button>
      {:else}
        <span><span class="tag warn">[WARN]</span> no alert channel — set <code>RW_NTFY_URL</code> or <code>RW_WEBHOOK_URL</code></span>
      {/if}
    {/if}
    {#if testMsg}<span><span class="tag {testMsg.cls}">[{testMsg.cls.toUpperCase()}]</span> {testMsg.text}</span>{/if}
    <label class="check"><input type="checkbox" bind:checked={showOk} /> show in-sync</label>
  </div>

  {#if !shown.length}
    <p class="pad">
      {#if items.length}<span class="tag ok">[OK]</span> every latest release is on its registry.
      {:else}<span class="tag info">[INFO]</span> nothing to compare yet — watch a repo with packages linked.{/if}
    </p>
  {:else}
    <div class="wrap">
      <table>
        <thead>
          <tr><th></th><th>repo</th><th>package</th><th>tag</th><th>tagged</th><th>waiting / lag</th><th>registry at</th><th></th></tr>
        </thead>
        <tbody>
          {#each shown as i (i.package_id)}
            <tr class:muted={i.muted}>
              <td><span class="tag {i.muted ? 'faint' : TAG[i.state].c}">[{TAG[i.state].t}]</span></td>
              <td><button class="link" onclick={() => onopen(i.source_id)}>{i.source_path}</button>
                <span class="faint host">{i.host}</span></td>
              <td><span class="reg">{REG_LABEL[i.registry]}</span> {i.name}</td>
              <td class="v">{#if safeUrl(i.git_url)}<a href={safeUrl(i.git_url)} target="_blank" rel="noreferrer noopener">{i.version}</a>{:else}{i.version}{/if}</td>
              <td class="dim" title={stamp(i.tagged_at)}>{ago(i.tagged_at)}</td>
              <td>
                {#if i.state === "ok"}<span class="dim">{i.lag_hours != null ? lag(i.lag_hours) : "—"}</span>
                {:else if i.state === "yanked"}<span class="err">yanked</span>
                {:else}<span class={i.state === "overdue" ? "err" : "warn"}>{span(i.hours)}</span>{/if}
              </td>
              <td class="dim">
                {#if i.state === "ok"}—{:else if i.registry_latest}{i.registry_latest} <span class="faint">{ago(i.registry_latest_at)}</span>
                {:else}<span class="faint">never published</span>{/if}
              </td>
              <td>
                <button class="ghost" title={i.muted ? "alerts off for this package" : "stop alerts for this package"}
                  onclick={() => toggleMute(i)}>{i.muted ? "unmute" : "mute"}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  section { min-width: 0; }
  .head { padding: 20px 24px 6px; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
  .head p { margin: 4px 0 0; font-size: 12px; }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 14px 24px; border: 1px solid var(--line); }
  .stat { padding: 12px 16px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; }
  .stat:last-child { border-right: 0; }
  .stat b { font-size: 24px; font-weight: 500; letter-spacing: -.03em; line-height: 1.1; }
  .stat span { color: var(--dim); font-size: 11px; }
  .stat.hot { background: color-mix(in srgb, var(--err) 7%, transparent); }
  b.err { color: var(--err); } b.warn { color: var(--warn); } b.ok { color: var(--ok); } b.faint { color: var(--faint); }
  .bar { display: flex; gap: 16px; align-items: center; padding: 10px 24px; border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
  .check { margin-left: auto; display: flex; gap: 8px; align-items: center; cursor: pointer; }
  code { color: var(--accent); }
  .pad { padding: 24px; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 8px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-weight: 500; color: var(--dim); border-bottom-color: var(--line-hi); }
  tbody tr:hover { background: var(--panel); }
  tr.muted td { opacity: .5; }
  .link { all: unset; cursor: pointer; font-weight: 600; }
  .link:hover { color: var(--accent); }
  .host { font-size: 11px; margin-left: 6px; }
  .reg { color: var(--accent); }
  .v { font-weight: 600; }
  .err { color: var(--err); } .warn { color: var(--warn); }
  @media (max-width: 860px) {
    .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 12px 16px; }
    .stat:nth-child(3) { border-right: 0; }
    .stat:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
    .head, .bar { padding-left: 16px; padding-right: 16px; }
  }
</style>
