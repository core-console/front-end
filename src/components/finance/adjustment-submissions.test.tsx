import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  adjustmentReceipt,
  adjustmentTestBody,
  adjustmentTestContext,
  adjustmentTestResource,
} from "@/test/adjustment-submission-fixtures";
import { submissionTestUser } from "@/test/submission-fixtures";
import {
  transactionTestAccounts as accounts,
  transactionTestLedger as ledger,
  transactionTestOtherLedger as otherLedger,
  transactionTestDate as date,
  transactionTestOverview,
  transactionTestDay,
} from "@/test/transaction-submission-fixtures";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceCurrenciesMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceCategoriesMockHandler,
  getListFinanceTransactionsMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import {
  getGetCurrentUserQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
import {
  prepareSubmission,
  readSubmissions,
  readSubmission,
  resolveSubmission,
  acknowledgeSubmission,
  blockConflictingSubmission,
  type CreateSubmissionCommand,
} from "./submission-journal";
import {
  createResponseResolution,
  errorResolution,
} from "./submission-evidence";
import {
  claimBalanceAdjustmentReplacement,
  releaseBalanceAdjustmentReplacement,
  balanceAdjustmentReplacementKey,
} from "./balance-adjustment-replacement-lock";
import { settleTransactionDeletion } from "./transaction-deletion";

const namespace = {
  apiBaseUrl: "http://localhost/api",
  ownerId: submissionTestUser.id,
};
const command = {
  operation: "createBalanceAdjustment",
  workflow: "balanceAdjustment",
  targetLedgerId: ledger.id,
  body: adjustmentTestBody,
} as const;

beforeEach(() => {
  localStorage.clear();
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger, otherLedger]),
    getListFinanceCurrenciesMockHandler([
      { code: "USD", minorUnit: 2 },
      { code: "JPY", minorUnit: 0 },
    ]),
    getListFinanceAccountsMockHandler([...accounts]),
    getListFinanceCategoriesMockHandler([]),
    getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    http.get("*/api/finance/ledgers/:ledgerId/overview", () =>
      HttpResponse.json(transactionTestOverview),
    ),
    http.get("*/api/finance/ledgers/:ledgerId/overview/day", () =>
      HttpResponse.json(transactionTestDay),
    ),
    http.get(
      "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
      ({ request, params }) =>
        HttpResponse.json({
          ...adjustmentTestContext,
          account: { ...adjustmentTestContext.account, id: params.accountId },
          transactionDate: new URL(request.url).searchParams.get(
            "transactionDate",
          ),
        }),
    ),
    http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", () =>
      HttpResponse.json(adjustmentTestResource),
    ),
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json(
        {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          code: "finance_submission_not_found",
        },
        { status: 404 },
      ),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());

it.each([
  { amount: "-0", currency: "JPY", nature: "liability" },
  { amount: "-9007199254740993.01", currency: "CNY", nature: "asset" },
  { amount: "0.00", currency: "USD", nature: "liability" },
] as const)(
  "preserves $currency $amount and $nature exactly across durable reload",
  async ({ amount, currency, nature }) => {
    const body: typeof adjustmentTestBody = {
      ...adjustmentTestBody,
      expectedAccountNature: nature,
      expectedDerivedBalance: { amount, currency },
      targetBalance: { amount, currency },
    };
    const record = await prepareSubmission(namespace, { ...command, body });
    body.targetBalance.amount = "changed";
    expect((await readSubmission(record))?.body).toMatchObject({
      expectedAccountNature: nature,
      expectedDerivedBalance: { amount, currency },
      targetBalance: { amount, currency },
    });
  },
);

it("retains the existing maximum integer range without truncating an Adjustment command", async () => {
  const amount = `-${"9".repeat(131_072)}.01`;
  const record = await prepareSubmission(namespace, {
    ...command,
    body: { ...adjustmentTestBody, targetBalance: { amount, currency: "USD" } },
  });
  expect((await readSubmission(record))?.body).toMatchObject({
    targetBalance: { amount, currency: "USD" },
  });
});

it("resolves noChange before a failed active Account refresh and preserves successful UI completion", async () => {
  let terminal = false;
  server.use(
    http.get("*/api/finance/ledgers/:ledgerId/accounts", async () => {
      if (!terminal) return HttpResponse.json(accounts);
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
      return HttpResponse.json({}, { status: 503 });
    }),
    http.post(
      "*/api/finance/ledgers/:ledgerId/balance-adjustments",
      ({ request }) => {
        terminal = true;
        return HttpResponse.json(
          adjustmentReceipt(request.headers.get("Idempotency-Key")!),
        );
      },
    ),
  );
  const { user, form } = await openAdjustment("overview");
  await user.click(
    within(form).getByRole("button", { name: "Record adjustment" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByText(/Current Finance resources could not refresh/),
  ).toBeVisible();
  expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
  expect(
    screen.queryByRole("button", { name: "Retry original submission" }),
  ).not.toBeInTheDocument();
});

it("keeps created success separate from current resource absence and failed reads", async () => {
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledgerId/balance-adjustments",
      ({ request }) =>
        HttpResponse.json(
          adjustmentReceipt(
            request.headers.get("Idempotency-Key")!,
            createdOutcome,
          ),
        ),
    ),
    http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", () =>
      HttpResponse.json({}, { status: 503 }),
    ),
  );
  const { user, form } = await openAdjustment();
  await user.click(
    within(form).getByRole("button", { name: "Record adjustment" }),
  );
  expect(
    await within(form).findByText(/The outcome is confirmed/),
  ).toBeVisible();
  expect(
    within(form).queryByText("Balance Adjustment outcome unknown"),
  ).not.toBeInTheDocument();
  expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
});

it("retains terminal noChange for the original owner without completing a new owner's workflow", async () => {
  let terminal = false;
  const nextUser = {
    ...submissionTestUser,
    id: "88888888-8888-4888-8888-888888888888",
  };
  server.use(
    http.get("*/api/me", () =>
      HttpResponse.json(terminal ? nextUser : submissionTestUser),
    ),
    http.post(
      "*/api/finance/ledgers/:ledgerId/balance-adjustments",
      ({ request }) => {
        terminal = true;
        return HttpResponse.json(
          adjustmentReceipt(request.headers.get("Idempotency-Key")!),
        );
      },
    ),
  );
  const { user, form, queryClient } = await openAdjustment("overview");
  await user.click(
    within(form).getByRole("button", { name: "Record adjustment" }),
  );
  await waitFor(() =>
    expect(queryClient.getQueryData(getGetCurrentUserQueryKey())).toMatchObject(
      {
        data: { id: nextUser.id },
      },
    ),
  );
  expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
  expect(form).toBeVisible();
  expect(
    screen.queryByText(
      "Balance already matched the target. No Balance Adjustment was created.",
    ),
  ).not.toBeInTheDocument();
  expect(await readSubmissions({ ...namespace, ownerId: nextUser.id })).toEqual(
    [],
  );
});

async function openAdjustment(
  origin: "transactions" | "overview" = "transactions",
) {
  const user = userEvent.setup();
  const rendered = renderRoute(
    `/finance/${origin}?ledger=${ledger.id}&month=2026-10&date=${date}`,
  );
  const trigger = await screen.findByRole(
    "button",
    {
      name:
        origin === "transactions"
          ? "Record transaction"
          : "Other transaction actions",
    },
    { timeout: 5000 },
  );
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  await user.click(
    await screen.findByRole("menuitem", { name: "Balance Adjustment" }),
  );
  const form = await screen.findByRole("dialog", {
    name: "Record balance adjustment",
  });
  fireEvent.change(within(form).getByLabelText("Transaction date"), {
    target: { value: date },
  });
  const target = within(form).getByLabelText("Target balance");
  await waitFor(() => expect(target).toBeEnabled());
  await user.type(target, adjustmentTestBody.targetBalance.amount);
  await user.type(
    within(form).getByLabelText("Note", { exact: true }),
    adjustmentTestBody.note!,
  );
  return { ...rendered, user, form, trigger };
}

it.each(["transactions", "overview"] as const)(
  "%s prepares before dispatch and completes noChange without reading a Transaction",
  async (origin) => {
    let reads = 0;
    server.use(
      http.post(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments",
        async ({ request }) => {
          const body = await request.json();
          const [record] = await readSubmissions(namespace);
          expect(record).toMatchObject({ state: "unresolved", body });
          expect(body).toEqual(adjustmentTestBody);
          expect(request.headers.get("Finance-Submission-Owner")).toBe(
            namespace.ownerId,
          );
          expect(request.headers.get("Finance-Command-Version")).toBe("1");
          return HttpResponse.json(
            adjustmentReceipt(request.headers.get("Idempotency-Key")!),
          );
        },
      ),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", () => {
        reads += 1;
        return HttpResponse.json(adjustmentTestResource);
      }),
    );
    const { user, form } = await openAdjustment(origin);
    await user.click(
      within(form).getByRole("button", { name: "Record adjustment" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(
        "Balance already matched the target. No Balance Adjustment was created.",
      ),
    ).toBeVisible();
    expect(reads).toBe(0);
    expect(
      screen.getByRole("status", {
        name: /Balance Adjustment requires no change/,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
  },
);

it("durably retains signed adjustment inputs and resolves noChange without a resource", async () => {
  const record = await prepareSubmission(
    namespace,
    command satisfies CreateSubmissionCommand,
  );
  expect((await readSubmission(record))?.body).toEqual(adjustmentTestBody);
  const resolution = createResponseResolution(
    record,
    adjustmentReceipt(record.submissionId),
  );
  expect(resolution).not.toBeNull();
  await resolveSubmission(record, resolution!);
  expect(await readSubmission(record)).toMatchObject({
    state: "resolved",
    resolution: { kind: "receipt", receipt: { outcome: { kind: "noChange" } } },
  });
});

const validationProblem = {
  type: "about:blank",
  title: "Validation Error",
  status: 422,
  code: "validation_error",
  detail: "Invalid adjustment.",
};
const conflictProblem = {
  type: "about:blank",
  title: "Conflict",
  status: 409,
  code: "account_balance_changed",
  detail: "Balance changed.",
} as const;
const createdOutcome = {
  kind: "created",
  resource: { type: "transaction", id: adjustmentTestResource.id },
} as const;

it("correlates adjustment success, rejection and Q29 against the exact immutable command", async () => {
  const record = await prepareSubmission(namespace, command);
  const receipt = adjustmentReceipt(record.submissionId);
  for (const change of [
    { submissionId: crypto.randomUUID() },
    { commandVersion: "2" },
    { operation: "createFinanceTransaction" },
    { targetLedgerId: otherLedger.id },
    { resolvedAt: "2026-10-01T00:00:00Z" },
    { outcome: { kind: "noChange", resource: createdOutcome.resource } },
    {
      outcome: {
        kind: "created",
        resource: { type: "account", id: adjustmentTestResource.id },
      },
    },
  ])
    expect(
      createResponseResolution(record, { ...receipt, ...change }),
    ).toBeNull();
  expect(
    createResponseResolution(record, { ...receipt, outcome: createdOutcome }),
  ).not.toBeNull();
  expect(errorResolution(record, conflictProblem)).toBeNull();
  expect(errorResolution(record, validationProblem)).toBeNull();
  const terminal = {
    ...conflictProblem,
    submissionReceipt: adjustmentReceipt(record.submissionId, {
      kind: "rejected",
      problem: conflictProblem,
    }),
  };
  expect(errorResolution(record, terminal)?.kind).toBe("receipt");
  const proof = {
    kind: "definitivelyNotAdmitted",
    ownerId: namespace.ownerId,
    submissionId: record.submissionId,
    operation: record.operation,
    commandVersion: "1",
    targetLedgerId: ledger.id,
    attemptedBody: record.body,
  };
  const q29 = {
    ...validationProblem,
    errors: [],
    commandValidationRejection: proof,
  };
  const resolution = errorResolution(record, q29);
  expect(resolution?.kind).toBe("notAdmitted");
  for (const change of [
    { ownerId: crypto.randomUUID() },
    { targetLedgerId: otherLedger.id },
    { commandVersion: "2" },
    { operation: "createFinanceAccount" },
    { submissionId: crypto.randomUUID() },
  ])
    expect(
      errorResolution(record, {
        ...q29,
        commandValidationRejection: { ...proof, ...change },
      }),
    ).toBeNull();
  for (const change of [
    { targetBalance: { amount: "0.00", currency: "USD" } },
    {
      expectedDerivedBalance: {
        amount: "-9007199254740993.00",
        currency: "USD",
      },
    },
    { expectedAccountNature: "liability" },
    { accountId: accounts[1].id },
    { note: null },
    { transactionDate: "2026-10-06" },
    { targetBalance: { amount: 0, currency: "USD" } },
  ])
    expect(
      errorResolution(record, {
        ...q29,
        commandValidationRejection: {
          ...proof,
          attemptedBody: { ...record.body, ...change },
        },
      }),
    ).toBeNull();
  await resolveSubmission(record, resolution!);
  await acknowledgeSubmission(record);
  expect(await readSubmission(record)).toBeNull();
  expect(await resolveSubmission(record, resolution!)).toBeNull();
  const blocked = await prepareSubmission(namespace, command);
  await blockConflictingSubmission(blocked);
  expect(
    createResponseResolution(
      (await readSubmission(blocked))!,
      adjustmentReceipt(blocked.submissionId),
    ),
  ).toBeNull();
});

it.each(["created", "noChange"] as const)(
  "retries the original adjustment after edits and Ledger navigation, resolving %s",
  async (kind) => {
    const posts: { key: string; path: string; body: unknown }[] = [];
    server.use(
      http.post(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments",
        async ({ request }) => {
          posts.push({
            key: request.headers.get("Idempotency-Key")!,
            path: new URL(request.url).pathname,
            body: await request.json(),
          });
          return posts.length === 1
            ? HttpResponse.json({}, { status: 200 })
            : HttpResponse.json(
                adjustmentReceipt(
                  posts[0]!.key,
                  kind === "created" ? createdOutcome : { kind: "noChange" },
                ),
              );
        },
      ),
    );
    const { user, form, router } = await openAdjustment();
    await user.click(
      within(form).getByRole("button", { name: "Record adjustment" }),
    );
    await waitFor(() =>
      expect(
        within(form).getByRole("button", { name: "Record adjustment" }),
      ).toBeDisabled(),
    );
    await user.clear(within(form).getByLabelText("Target balance"));
    await user.type(within(form).getByLabelText("Target balance"), "12.34");
    fireEvent.change(within(form).getByLabelText("Transaction date"), {
      target: { value: "2026-10-06" },
    });
    await user.selectOptions(
      within(form).getByLabelText("Account", { exact: true }),
      accounts[1].id,
    );
    await user.clear(within(form).getByLabelText("Note", { exact: true }));
    await user.type(
      within(form).getByLabelText("Note", { exact: true }),
      "New draft",
    );
    expect(posts).toHaveLength(1);
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await act(() =>
      router.navigate(`/finance/categories?ledger=${otherLedger.id}`),
    );
    const retry = await screen.findByRole("button", {
      name: "Retry original submission",
    });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Acknowledge outcome" }),
      ).toBeEnabled(),
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]!.body).toEqual(adjustmentTestBody);
    expect((await readSubmissions(namespace))[0]).toMatchObject({
      state: "resolved",
      body: adjustmentTestBody,
    });
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  conflictProblem,
  validationProblem,
  { ...conflictProblem, code: "finance_account_semantics_changed" },
])(
  "keeps bare $code unresolved without refreshing submitted expectations",
  async (problem) => {
    let contexts = 0;
    let posts = 0;
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ request }) => {
          contexts += 1;
          return HttpResponse.json({
            ...adjustmentTestContext,
            transactionDate: new URL(request.url).searchParams.get(
              "transactionDate",
            ),
          });
        },
      ),
      http.post("*/api/finance/ledgers/:ledgerId/balance-adjustments", () => {
        posts += 1;
        return HttpResponse.json(problem, { status: problem.status });
      }),
    );
    const { user, form } = await openAdjustment("overview");
    const before = contexts;
    await user.click(
      within(form).getByRole("button", { name: "Record adjustment" }),
    );
    await waitFor(() =>
      expect(
        within(form).getByRole("button", { name: "Record adjustment" }),
      ).toBeDisabled(),
    );
    expect(contexts).toBe(before);
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    expect(posts).toBe(1);
    expect(
      screen.queryByText("Review the refreshed context.", { exact: false }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  "account_balance_changed",
  "finance_account_semantics_changed",
] as const)(
  "only a correlated %s rejection permits a new command with refreshed expectations",
  async (code) => {
    const posts: { key: string; body: unknown }[] = [];
    let rejected = false;
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ request }) =>
          HttpResponse.json({
            ...adjustmentTestContext,
            transactionDate: new URL(request.url).searchParams.get(
              "transactionDate",
            ),
            accountNature: rejected ? "liability" : "asset",
            derivedComparisonBalance: rejected
              ? { amount: "12.34", currency: "USD" }
              : adjustmentTestBody.expectedDerivedBalance,
          }),
      ),
      http.post(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments",
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          posts.push({ key, body: await request.json() });
          if (posts.length > 1)
            return HttpResponse.json(adjustmentReceipt(key));
          rejected = true;
          const problem = { ...conflictProblem, code };
          return HttpResponse.json(
            {
              ...problem,
              submissionReceipt: adjustmentReceipt(key, {
                kind: "rejected",
                problem: { ...problem, status: 409 },
              }),
            },
            { status: 409 },
          );
        },
      ),
    );
    const { user, form } = await openAdjustment("overview");
    const button = within(form).getByRole("button", {
      name: "Record adjustment",
    });
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(
      await within(form).findByText("Review the refreshed context.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(within(form).getByLabelText("Target balance")).toHaveValue("-0.00");
    await user.click(button);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(posts[1]!.key).not.toBe(posts[0]!.key);
    expect(posts[1]!.body).toEqual({
      ...adjustmentTestBody,
      expectedAccountNature: "liability",
      expectedDerivedBalance: { amount: "12.34", currency: "USD" },
    });
    expect(
      (await readSubmissions(namespace)).find(
        (record) => record.submissionId === posts[0]!.key,
      )?.body,
    ).toEqual(adjustmentTestBody);
  },
);

it.each(["created", "noChange"] as const)(
  "durably resolves %s lookup before failed resource refresh and never executes",
  async (kind) => {
    const record = await prepareSubmission(namespace, command);
    let posts = 0;
    let detailReads = 0;
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: adjustmentReceipt(
            record.submissionId,
            kind === "created" ? createdOutcome : { kind: "noChange" },
          ),
        }),
      ),
      http.post("*/api/finance/ledgers/:ledgerId/balance-adjustments", () => {
        posts += 1;
        return HttpResponse.json({});
      }),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", async () => {
        detailReads += 1;
        expect((await readSubmission(record))?.state).toBe("resolved");
        return HttpResponse.json({}, { status: 503 });
      }),
    );
    // Use a normal problem response for the active Account refresh.
    server.use(
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Unavailable",
            code: "database_unavailable",
            status: 503,
          },
          { status: 503 },
        ),
      ),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);
    await waitFor(async () =>
      expect((await readSubmission(record))?.state).toBe("resolved"),
    );
    expect(
      await screen.findByRole("button", { name: "Acknowledge outcome" }),
    ).toBeVisible();
    expect(posts).toBe(0);
    expect(detailReads).toBe(kind === "created" ? 1 : 0);
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
  },
);

it.each(["unfinished", "absent", "mismatch"] as const)(
  "retains unresolved adjustment on %s lookup",
  async (state) => {
    const record = await prepareSubmission(namespace, command);
    if (state !== "absent")
      server.use(
        http.get("*/api/finance/submissions/:id", () =>
          HttpResponse.json(
            state === "mismatch"
              ? {
                  state: "terminal",
                  receipt: {
                    ...adjustmentReceipt(record.submissionId),
                    targetLedgerId: otherLedger.id,
                  },
                }
              : {
                  state: "unfinished",
                  operation: record.operation,
                  submissionId: record.submissionId,
                  targetLedgerId: ledger.id,
                  commandVersion: "1",
                  admittedAt: "2026-10-06T00:00:00Z",
                },
          ),
        ),
      );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);
    expect(
      await screen.findByRole("button", { name: "Retry original submission" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check outcome" }),
      ).toBeEnabled(),
    );
    expect((await readSubmission(record))?.state).toBe("unresolved");
  },
);

it("blocks dispatch when durable adjustment preparation fails", async () => {
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledgerId/balance-adjustments", () => {
      posts += 1;
      return HttpResponse.json({});
    }),
  );
  const { user, form } = await openAdjustment();
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
    throw new DOMException("Quota", "QuotaExceededError");
  });
  await user.click(
    within(form).getByRole("button", { name: "Record adjustment" }),
  );
  expect(
    await within(form).findByText(/Browser storage write failed/),
  ).toBeVisible();
  expect(posts).toBe(0);
});

it("keeps terminal evidence pending when its resolution write fails, then resolves through lookup", async () => {
  let key = "";
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledgerId/balance-adjustments",
      ({ request }) => {
        key = request.headers.get("Idempotency-Key")!;
        return HttpResponse.json(adjustmentReceipt(key));
      },
    ),
  );
  const { user, form } = await openAdjustment();
  const write = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
  await user.click(
    within(form).getByRole("button", { name: "Record adjustment" }),
  );
  await waitFor(() =>
    expect(
      within(form).getByRole("button", { name: "Record adjustment" }),
    ).toBeDisabled(),
  );
  expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
  write.mockRestore();
  server.use(
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json({ state: "terminal", receipt: adjustmentReceipt(key) }),
    ),
  );
  await user.click(within(form).getByRole("button", { name: "Cancel" }));
  await user.click(
    await screen.findByRole("button", { name: "Check outcome" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument(),
  );
});

it.each(["replacement", "deletion"] as const)(
  "does not project a resource read spanning Adjustment %s",
  async (change) => {
    const record = await prepareSubmission(namespace, command);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading = false;
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: adjustmentReceipt(record.submissionId, createdOutcome),
        }),
      ),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", async () => {
        reading = true;
        await gate;
        return HttpResponse.json(adjustmentTestResource);
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/categories?ledger=${ledger.id}`,
    );
    await waitFor(() => expect(reading).toBe(true));
    queryClient.setQueryData(getListFinanceTransactionsQueryKey(ledger.id), {
      data: { items: [], nextCursor: null },
      status: 200,
      headers: new Headers(),
    });
    if (change === "replacement") {
      const session = claimBalanceAdjustmentReplacement(
        balanceAdjustmentReplacementKey(ledger.id, adjustmentTestResource.id),
      )!;
      releaseBalanceAdjustmentReplacement(session);
    } else
      await settleTransactionDeletion(
        queryClient,
        adjustmentTestResource,
        "deleted",
      );
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh Finance resources" }),
      ).toBeEnabled(),
    );
    expect(
      queryClient.getQueryData(getListFinanceTransactionsQueryKey(ledger.id)),
    ).toMatchObject({ data: { items: [] } });
    expect((await readSubmission(record))?.state).toBe("resolved");
  },
);
