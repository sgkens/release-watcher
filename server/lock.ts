// Per-source serialisation. The poller, manual syncs and alert checks all go through this,
// so one source never has two syncs or two alert checks in flight at once.
const chains = new Map<number, Promise<unknown>>();

export function withLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(id, next);
  next.finally(() => {
    if (chains.get(id) === next) chains.delete(id);
  }).catch(() => {});
  return next;
}
