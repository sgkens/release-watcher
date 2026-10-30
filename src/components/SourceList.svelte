<script lang="ts">
  import type { Source } from "../lib/api";
  import { ago, lag, REG_LABEL, STATUS, vlabel } from "../lib/format";

  let { sources, loading, selected, onselect }: {
    sources: Source[]; loading: boolean; selected: number | null; onselect: (id: number) => void;
  } = $props();

  // overall health of a source: worst status across registries for the latest release
  const health = (s: Source) =>
    s.last_error ? "err"
    : s.coverage.some((c) => c.status === "missing" || c.status === "yanked") ? "warn"
    : s.latest ? "ok" : "info";
</script>

<section class:compact={selected}>
  {#if !sources.length}
    <div class="empty dim">
      {#if loading}loading…{:else}
        <p><span class="tag info">[INFO]</span> nothing watched yet.</p>
        <p class="faint">paste a repo url above — manifests are scanned to find npm / jsr / crates / pypi names.</p>
      {/if}
    </div>
  {/if}

  <ul>
    {#each sources as s (s.id)}
      <li>
        <button class="card" class:active={s.id === selected} onclick={() => onselect(s.id)}>
          <div class="top">
            <span class="dot {health(s)}"></span>
            <span class="path">{s.path}</span>
            <span class="host faint">{s.host}</span>
          </div>
          <div class="ver">
            {#if s.latest}
              <span class="v">{vlabel(s.latest)}</span>
              <span class="dim">{ago(s.latest_at)}</span>
            {:else}
              <span class="faint">no git releases</span>
            {/if}
          </div>
          {#if s.coverage.length}
            <div class="chips">
              {#each s.coverage as c}
                <span class="chip {STATUS[c.status].cls}" title="{c.name}: {STATUS[c.status].hint}">
                  {REG_LABEL[c.registry]}
                  {#if c.status === "published"}<b>✓</b> <i>{lag(c.lag_hours)}</i>{:else if c.status === "missing"}<b>✗</b>{:else}<b>!</b>{/if}
                </span>
              {/each}
            </div>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  section { border-right: 1px solid var(--line); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .compact ul { grid-template-columns: 1fr; }
  li { border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); }
  .compact li { border-right: 0; }
  .card { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 14px 20px; cursor: pointer;
    border-left: 2px solid transparent; transition: background .12s; }
  .card:hover { background: var(--panel); }
  .card.active { background: var(--raise); border-left-color: var(--accent); }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .path { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .host { margin-left: auto; font-size: 11px; flex-shrink: 0; }
  .dot { width: 7px; height: 7px; flex-shrink: 0; background: var(--faint); }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); }
  .dot.err { background: var(--err); } .dot.info { background: var(--info); }
  .ver { margin: 6px 0 8px; display: flex; gap: 10px; align-items: baseline; }
  .v { font-size: 18px; font-weight: 500; letter-spacing: -.02em; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--line); padding: 1px 7px; font-size: 11px; color: var(--dim); }
  .chip b { font-weight: 600; }
  .chip i { font-style: normal; color: var(--faint); }
  .chip.ok b { color: var(--ok); } .chip.warn b { color: var(--warn); }
  .chip.err b { color: var(--err); } .chip.faint b { color: var(--err); }
  .empty { padding: 40px 24px; }
  .empty p { margin: 4px 0; }
</style>
