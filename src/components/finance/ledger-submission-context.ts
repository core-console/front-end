import { createContext, useContext } from "react";
import type { LedgerResponse } from "@/api/generated/schemas";
import type { LedgerSubmission } from "./submission-journal";
export type SubmitResult = {
  record: LedgerSubmission;
  ledger?: LedgerResponse | undefined;
  message?: string;
};
export type SubmissionContext = {
  partitionKey: string;
  ready: boolean;
  records: LedgerSubmission[];
  storageError: string | null;
  messages: Record<string, string>;
  busy: ReadonlySet<string>;
  submit: (
    name: string,
    workflow: "onboarding" | "additional",
    prepared: (id: string) => void,
  ) => Promise<SubmitResult>;
  retry: (record: LedgerSubmission) => Promise<void>;
  lookup: (record: LedgerSubmission) => Promise<void>;
  acknowledge: (record: LedgerSubmission) => Promise<void>;
  refreshLedgerList: (record: LedgerSubmission) => Promise<void>;
  recover: () => Promise<void>;
};
export const LedgerSubmissionContext = createContext<SubmissionContext | null>(
  null,
);
export function useLedgerSubmissions() {
  const context = useContext(LedgerSubmissionContext);
  if (!context)
    throw new Error(
      "Ledger submissions require the Finance recovery boundary.",
    );
  return context;
}
