<script lang="ts">
  import { api, type Pkg } from "../lib/api";
  import { REG_LABEL } from "../lib/format";

  let { sourceId, packages, busy, run }: {
    sourceId: number; packages: Pkg[]; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>;
  } = $props();

  let adding = $state(false);
  let registry = $state("npm");
  let name = $state("");
  let prefix = $state("");

  async function add(e: Event) {
    e.preventDefault();
    await run(() => api.addPackage(sourceId, registry, name.trim(), prefix.trim() || undefined));
    name = ""; prefix = ""; adding = false;
  }

  // inline tag-prefix editing (Enter saves, Esc cancels)
  let editing = $state<number | null>(null);
  let draft = $state("");

  function startEdit(p: Pkg) {
    editing = p.id;
    draft = p.tag_prefix ?? "";
  }
  function onEditKey(e: KeyboardEvent, p: Pkg) {
    if (e.key === "Escape") editing = null;
    if (e.key === "Enter") {
      e.preventDefault();
      const v = draft.trim() || null;
      editing = null;
      if (v !== p.tag_prefix) run(() => api.setPrefix(p.id, v));
    }
  }
  const focus = (el: HTMLInputElement) => { el.focus(); el.select(); };
</script>

<div class="pkgs">
  {#each packages as p (p.id)}
    <span class="pkg" title={p.resolved_by === "manifest" ? `from ${p.manifest_path}` : "added manually"}>
      <span class="reg">{REG_LABEL[p.registry]}</span>
      <span>{p.name}</span>
      {#if editing === p.id}
        <input class="pre-in" use:focus bind:value={draft} placeholder="{p.name}@" maxlength="100"
          onkeydown={(e) => onEditKey(e, p)} onblur={() => (editing = null)}
          aria-label="tag prefix for {p.name}" title="Tags for this package start with… (Enter to save, Esc to cancel, empty for none)" />
      {:else if p.tag_prefix}<button class="ghost pre" title="tags matched by prefix — click to edit" onclick={() => startEdit(p)}>tag:{p.tag_prefix}</button>
      {:else}<button class="ghost pre faint" title="set a tag prefix for monorepo tags like name@1.2.3" onclick={() => startEdit(p)}>+prefix</button>{/if}
      <span class="src faint">{p.resolved_by === "manifest" ? "auto" : "manual"}</span>
      <button class="ghost mute" class:on={p.muted} disabled={busy} title={p.muted ? "alerts off — click to unmute" : "click to stop drift alerts"}
        onclick={() => run(() => api.setMuted(p.id, !p.muted))}>{p.muted ? "muted" : "alerts"}</button>
      <button class="ghost x" disabled={busy} onclick={() => run(() => api.removePackage(p.id))} aria-label="remove">✕</button>
    </span>
  {:else}
    <span class="dim"><span class="tag warn">[WARN]</span> no packages linked — couldn't resolve from manifests.</span>
  {/each}

  {#if adding}
    <form onsubmit={add}>
      <select bind:value={registry}>
        {#each Object.entries(REG_LABEL) as [id, label]}<option value={id}>{label}</option>{/each}
      </select>
      <input placeholder={registry === "jsr" ? "@scope/name" : "package name"} bind:value={name} required />
      <input class="prefix" placeholder="tag prefix (opt)" bind:value={prefix} />
      <button class="primary" disabled={busy || !name.trim()}>add</button>
      <button type="button" class="ghost" onclick={() => (adding = false)}>cancel</button>
    </form>
  {:else}
    <button onclick={() => (adding = true)}>+ package</button>
  {/if}
</div>

<style>
  .pkgs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 14px 24px; border-bottom: 1px solid var(--line); }
  .pkg { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line-hi); padding: 3px 4px 3px 0; }
  .reg { background: var(--raise); color: var(--accent); padding: 3px 8px; margin: -3px 0; border-right: 1px solid var(--line-hi); }
  .pre { font-size: 11px; color: var(--info); }
  .pre.faint { color: var(--faint); }
  .pre-in { width: 120px; padding: 1px 6px; font-size: 11px; }
  .src { font-size: 11px; }
  .mute { font-size: 11px; color: var(--faint); }
  .mute.on { color: var(--warn); }
  .x:hover { color: var(--err) !important; }
  form { display: flex; gap: 6px; flex-wrap: wrap; }
  .prefix { width: 140px; }
  @media (max-width: 860px) { .pkgs { padding: 12px 16px; } }
</style>
