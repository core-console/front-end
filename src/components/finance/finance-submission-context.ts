import { createContext, useContext } from "react";
import type {
  LedgerResponse,
  AccountResponse,
  CategoryResponse,
  FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import type {
  FinanceSubmission,
  CreateSubmissionCommand,
} from "./submission-journal";
export type SubmitResult = {
  record: FinanceSubmission;
  ledger?: LedgerResponse | undefined;
  account?: AccountResponse | undefined;
  category?: CategoryResponse | undefined;
  transaction?: FinanceTransactionResponseOutput | undefined;
  refreshing?: Promise<void>;
  message?: string;
};
export type SubmissionContext = {
  partitionKey: string;
  ready: boolean;
  records: FinanceSubmission[];
  storageError: string | null;
  messages: Record<string, string>;
  busy: ReadonlySet<string>;
  submit: (
    command: CreateSubmissionCommand,
    prepared: (id: string) => void,
  ) => Promise<SubmitResult>;
  retry: (record: FinanceSubmission) => Promise<void>;
  lookup: (record: FinanceSubmission) => Promise<void>;
  acknowledge: (record: FinanceSubmission) => Promise<void>;
  refreshResourceList: (record: FinanceSubmission) => Promise<void>;
  recover: () => Promise<void>;
};
export const FinanceSubmissionContext = createContext<SubmissionContext | null>(
  null,
);
export function useFinanceSubmissions() {
  const context = useContext(FinanceSubmissionContext);
  if (!context)
    throw new Error(
      "Finance submissions require the Finance recovery boundary.",
    );
  return context;
}
