<script lang="ts">
  import { api, type DriftItem, type Source } from "./lib/api";
  import AddSource from "./components/AddSource.svelte";
  import SourceList from "./components/SourceList.svelte";
  import SourceDetail from "./components/SourceDetail.svelte";
  import DriftView from "./components/DriftView.svelte";

  let sources = $state<Source[]>([]);
  let query = $state("");
  let selected = $state<number | null>(Number(location.hash.match(/#\/s\/(\d+)/)?.[1]) || null);
  let loading = $state(true);
  let view = $state<"sources" | "drift">(location.hash.startsWith("#/drift") ? "drift" : "sources");
  let drift = $state<DriftItem[]>([]);
  const overdue = $derived(drift.filter((d) => (d.state === "overdue" || d.state === "yanked") && !d.muted).length);

  async function loadDrift() {
    try { drift = await api.drift(); } catch {}
  }
  loadDrift();
  setInterval(loadDrift, 5 * 60_000);

  function refresh() { load(); loadDrift(); }

  function show(v: "sources" | "drift") {
    view = v;
    if (v === "drift") { selected = null; history.replaceState(null, "", "#/drift"); loadDrift(); }
    else history.replaceState(null, "", selected ? `#/s/${selected}` : "#/");
  }

  async function load() {
    loading = true;
    try { sources = await api.list(query); } finally { loading = false; }
  }

  // debounce search
  let t: ReturnType<typeof setTimeout>;
  $effect(() => {
    query;
    clearTimeout(t);
    t = setTimeout(load, 180);
  });

  function select(id: number | null) {
    selected = id;
    view = "sources";
    history.replaceState(null, "", id ? `#/s/${id}` : "#/");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      document.getElementById("search")?.focus();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<header>
  <a class="brand" href="#/" onclick={() => select(null)}>
    <span class="caret">▍</span>release-watcher
  </a>
  <label class="search">
    <span class="dim">/</span>
    <input id="search" placeholder="search repos or packages" bind:value={query} autocomplete="off" />
  </label>
  <nav>
    <button class:on={view === "sources"} onclick={() => show("sources")}>sources <span class="n">{sources.length}</span></button>
    <button class:on={view === "drift"} onclick={() => show("drift")}>
      drift {#if overdue}<span class="n hot">{overdue}</span>{:else}<span class="n">0</span>{/if}
    </button>
  </nav>
</header>

<AddSource onadded={(s) => { refresh(); select(s.id); }} />

{#if view === "drift"}
  <main><DriftView items={drift} onopen={select} onrefresh={loadDrift} /></main>
{:else}
  <main class:has-detail={selected}>
    <SourceList {sources} {loading} {selected} onselect={select} />
    {#if selected}
      {#key selected}
        <SourceDetail id={selected} onchange={refresh} onclose={() => select(null)} />
      {/key}
    {/if}
  </main>
{/if}

<style>
  header {
    display: flex; align-items: center; gap: 20px;
    padding: 14px 24px; border-bottom: 1px solid var(--line);
    position: sticky; top: 0; background: var(--bg); z-index: 5;
  }
  .brand { white-space: nowrap; font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
  .caret { color: var(--accent); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .search { flex: 1; max-width: 520px; display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--line); padding-left: 10px; }
  .search:focus-within { border-color: var(--accent); }
  .search input { border: 0; flex: 1; padding-left: 0; background: transparent; }
  nav { margin-left: auto; display: flex; }
  nav button { background: none; border: 1px solid var(--line); color: var(--dim); display: flex; gap: 8px; align-items: center; }
  nav button + button { border-left: 0; }
  nav button.on { color: var(--text); border-color: var(--line-hi); background: var(--raise); box-shadow: inset 0 -2px 0 var(--accent); }
  .n { font-size: 11px; color: var(--faint); }
  .n.hot { background: var(--err); color: var(--bg); padding: 0 6px; font-weight: 600; }
  main { display: grid; grid-template-columns: 1fr; min-height: calc(100vh - 120px); }
  main.has-detail { grid-template-columns: minmax(300px, 380px) 1fr; }
  @media (max-width: 860px) {
    main.has-detail { grid-template-columns: 1fr; }
    header { padding: 12px 16px; gap: 10px 12px; flex-wrap: wrap; }
    .search { order: 3; flex: 1 0 100%; max-width: none; }
  }
</style>
