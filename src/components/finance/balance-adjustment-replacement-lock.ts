import { useSyncExternalStore } from "react";

type ReplacementSession = {
  key: string;
  transactionMissingObserved: boolean;
};
const sessions = new Map<string, ReplacementSession>();
const listeners = new Set<() => void>();

export const balanceAdjustmentReplacementKey = (
  ledgerId: string,
  transactionId: string,
) => JSON.stringify([ledgerId, transactionId]);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

export function claimBalanceAdjustmentReplacement(key: string) {
  if (sessions.has(key)) return null;
  const session: ReplacementSession = {
    key,
    transactionMissingObserved: false,
  };
  sessions.set(key, session);
  notify();
  return session;
}

export function observeBalanceAdjustmentTransactionMissing(key: string) {
  const session = sessions.get(key);
  if (!session) return false;
  session.transactionMissingObserved = true;
  return true;
}

export function releaseBalanceAdjustmentReplacement(
  session: ReplacementSession,
) {
  if (sessions.get(session.key) !== session) return;
  sessions.delete(session.key);
  notify();
}

export function useBalanceAdjustmentReplacementPending(
  ledgerId: string,
  transactionId: string,
) {
  const key = balanceAdjustmentReplacementKey(ledgerId, transactionId);
  return useSyncExternalStore(subscribe, () => sessions.has(key));
}
