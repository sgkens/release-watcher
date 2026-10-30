import { db } from "./db";
import { checkAlerts } from "./drift";
import { withLock } from "./lock";
import { syncSource } from "./sync";

/** Sync a source, then open/resolve drift alerts for it — serialised per source. */
export function syncAndCheck(id: number) {
  return withLock(id, async () => {
    await syncSource(id);
    try {
      const r = await checkAlerts(id);
      if (r.notified || r.resolved) console.log(`[INFO] alerts source=${id} notified=${r.notified} resolved=${r.resolved}`);
    } catch (e) {
      console.error(`[ERR] alerts ${id}`, e);
    }
  });
}

export function startPoller(minutes = Number(process.env.RW_POLL_MINUTES ?? 60)) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const due = db.query<{ id: number }, [number]>(
        "SELECT id FROM sources WHERE last_synced IS NULL OR last_synced < datetime('now', '-' || ? || ' minutes')",
      ).all(minutes);
      // sequential on purpose: stays well inside unauthenticated rate limits; every fetch has a timeout
      for (const { id } of due) await syncAndCheck(id).catch((e) => console.error(`[ERR] sync ${id}`, e));

      // pending drift can become overdue without a new sync — re-check everything (no network calls)
      const all = db.query<{ id: number }, []>("SELECT id FROM sources").all();
      for (const { id } of all) await withLock(id, () => checkAlerts(id)).catch(() => {});
    } finally {
      running = false;
    }
  };
  setInterval(tick, 5 * 60_000);
  tick();
}
