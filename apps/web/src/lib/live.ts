/**
 * Live streaming buffers. The daemon emits two flavors of `message.delta`:
 * `{threadId, text}` — incremental assistant text for the running turn — and
 * `{threadId, messageId}` — a signal that a persisted message just appeared.
 * Deltas accumulate here per thread; `message.appended` / turn-end clears them.
 */
export type DeltaListener = () => void;

const buffers = new Map<string, string>();
const listeners = new Set<DeltaListener>();

export function pushDelta(threadId: string, text: string): void {
  buffers.set(threadId, (buffers.get(threadId) ?? "") + text);
  for (const l of listeners) l();
}

export function clearDelta(threadId: string): void {
  if (buffers.delete(threadId)) for (const l of listeners) l();
}

export function getDelta(threadId: string): string {
  return buffers.get(threadId) ?? "";
}

export function subscribeDeltas(listener: DeltaListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
