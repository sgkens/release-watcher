<script lang="ts">
  import type { Cell, Pkg, Row } from "../lib/api";
  import { ago, date, lag, REG_LABEL, safeUrl, stamp, STATUS } from "../lib/format";

  let { packages, rows }: { packages: Pkg[]; rows: Row[] } = $props();
</script>

{#snippet cell(c: Cell, isGit = false)}
  {@const st = STATUS[c.status]}
  <td class={c.status} title={c.status === "missing" ? st.hint : undefined}>
    {#if c.status === "missing"}
      <span class="faint">{isGit ? "no tag" : "—"}</span>
    {:else}
      <a href={safeUrl(c.url)} target="_blank" rel="noreferrer noopener" title="{st.hint} · {stamp(c.published_at)}">
        <span class="tag {st.cls}">[{st.tag}]</span>
        <span class="d">{date(c.published_at)}</span>
        {#if !isGit && c.lag_hours != null}
          <span class="lag" class:slow={c.lag_hours > 72} class:early={c.lag_hours < 0}>{lag(c.lag_hours)}</span>
        {/if}
      </a>
    {/if}
  </td>
{/snippet}

<div class="wrap">
  {#if !rows.length}
    <p class="dim pad"><span class="tag info">[INFO]</span> no releases in range.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>version</th>
          <th>git</th>
          {#each packages as p (p.id)}
            <th><span class="reg">{REG_LABEL[p.registry]}</span> <span class="dim">{p.name}</span></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.version)}
          <tr class:pre={r.prerelease}>
            <th scope="row">
              {r.version}
              {#if r.prerelease}<span class="faint">pre</span>{/if}
              {#if r.git.published_at}<span class="ago faint">{ago(r.git.published_at).replace(" ago", "")}</span>{/if}
            </th>
            {@render cell(r.git, true)}
            {#each packages as p (p.id)}{@render cell(r.packages[p.id])}{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <p class="legend faint">
    <span class="tag ok">[OK]</span> published ·
    <span class="tag warn">[WARN]</span> on registry, no git release ·
    <span class="tag err">[YANK]</span> yanked/deprecated ·
    lag = registry publish − git release
  </p>
</div>

<style>
  .wrap { overflow-x: auto; }
  .pad { padding: 24px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 7px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  thead th { position: sticky; top: 0; background: var(--bg); font-weight: 500; color: var(--dim); border-bottom-color: var(--line-hi); }
  .reg { color: var(--accent); }
  tbody th { font-weight: 600; font-size: 13px; }
  tbody th .ago { font-weight: 400; margin-left: 6px; font-size: 11px; }
  tbody tr:hover { background: var(--panel); }
  tr.pre th { font-weight: 400; color: var(--dim); }
  td a { display: inline-flex; gap: 8px; align-items: baseline; }
  .d { color: var(--dim); }
  .lag { color: var(--faint); font-size: 11px; }
  .lag.slow { color: var(--warn); }
  .lag.early { color: var(--info); }
  td.missing { background: repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.015) 6px 7px); }
  .legend { padding: 12px 24px; font-size: 11px; margin: 0; }
</style>
