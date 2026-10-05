const locks = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
export const replacementKey = (ledgerId: string, transactionId: string) =>
  JSON.stringify([ledgerId, transactionId]);
function notify() {
  revision += 1;
  for (const listener of listeners) listener();
}
export function subscribeReplacement(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function claimReplacement(key: string) {
  if (locks.has(key)) return false;
  locks.add(key);
  notify();
  return true;
}
export function releaseReplacement(key: string) {
  locks.delete(key);
  notify();
}
export function replacementPending(key: string) {
  return locks.has(key);
}
// A resource read spanning a replacement must not project the earlier result.
export function replacementRevision() {
  return revision;
}
