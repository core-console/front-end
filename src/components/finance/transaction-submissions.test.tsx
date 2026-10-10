import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBObjectStore } from "fake-indexeddb";
import { http, HttpResponse } from "msw";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  getGetCurrentUserQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
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
  createdTransactionReceipt,
  rejectedTransactionReceipt,
  submissionTestUser,
} from "@/test/submission-fixtures";
import {
  transactionTestLedger as ledger,
  transactionTestOtherLedger as otherLedger,
  transactionTestAccounts as accounts,
  transactionTestCategories as categories,
  transactionTestDate as date,
  transactionTestMoney as money,
  transactionTestId as id,
  transactionTestBody,
  transactionTestResource,
  transactionTestOverview,
  transactionTestDay,
  transactionTestKinds,
} from "@/test/transaction-submission-fixtures";
import {
  prepareSubmission,
  readSubmissions,
  readSubmission,
  resolveSubmission,
  blockConflictingSubmission,
  type CreateSubmissionCommand,
} from "./submission-journal";
import {
  createResponseResolution,
  errorResolution,
} from "./submission-evidence";
import {
  claimReplacement,
  releaseReplacement,
  replacementKey,
} from "./ordinary-transaction-replacement";
import { settleTransactionDeletion } from "./transaction-deletion";

const namespace = {
  apiBaseUrl: "http://localhost/api",
  ownerId: submissionTestUser.id,
};
const problem = {
  type: "about:blank",
  title: "Validation Error",
  status: 422,
  code: "validation_error",
  detail: "Transfer Accounts and amount must use the same currency.",
};
const entries = [
  { kind: "expense", origin: "quick" },
  { kind: "income", origin: "quick" },
  { kind: "expense", origin: "transactions" },
  { kind: "income", origin: "transactions" },
  { kind: "internalTransfer", origin: "transactions" },
  { kind: "internalTransfer", origin: "overview" },
] as const;
const command = (
  kind: (typeof transactionTestKinds)[number],
): CreateSubmissionCommand => ({
  operation: "createFinanceTransaction",
  workflow: kind === "internalTransfer" ? "internalTransfer" : "transaction",
  targetLedgerId: ledger.id,
  body: transactionTestBody(kind),
});

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
    getListFinanceCategoriesMockHandler([...categories]),
    getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    http.get("*/api/finance/ledgers/:ledgerId/overview", () =>
      HttpResponse.json(transactionTestOverview),
    ),
    http.get("*/api/finance/ledgers/:ledgerId/overview/day", () =>
      HttpResponse.json(transactionTestDay),
    ),
    http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", () =>
      HttpResponse.json(transactionTestResource("expense")),
    ),
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json(
        { ...problem, status: 404, code: "finance_submission_not_found" },
        { status: 404 },
      ),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());

async function openEntry(entry: (typeof entries)[number]) {
  const user = userEvent.setup();
  const rendered = renderRoute(
    entry.origin === "transactions"
      ? `/finance/transactions?ledger=${ledger.id}`
      : `/finance/overview?ledger=${ledger.id}&month=2026-10&date=${date}`,
  );
  if (entry.origin === "transactions") {
    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", {
        name:
          entry.kind === "internalTransfer"
            ? "Internal Transfer"
            : entry.kind === "income"
              ? "Income"
              : "Expense",
      }),
    );
  } else if (entry.origin === "overview") {
    const trigger = await screen.findByRole("button", {
      name: "其他 Transaction 操作",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
  }
  const form =
    entry.origin === "quick"
      ? await screen.findByRole(
          "form",
          { name: "快速记账" },
          // Overview is lazy-loaded; wait for its public workflow to be ready.
          { timeout: 5000 },
        )
      : await screen.findByRole("dialog");
  if (entry.origin === "quick" && entry.kind === "income")
    await user.click(within(form).getByRole("button", { name: "收入" }));
  await user.type(
    within(form).getByLabelText(entry.origin === "quick" ? "金额" : "Amount", {
      exact: true,
    }),
    money.amount,
  );
  if (entry.kind === "internalTransfer")
    await user.selectOptions(
      within(form).getByLabelText("Destination Account"),
      accounts[1].id,
    );
  else
    await user.selectOptions(
      within(form).getByLabelText("Category", { exact: true }),
      categories[1].id,
    );
  if (entry.origin !== "quick")
    fireEvent.change(within(form).getByLabelText("Transaction date"), {
      target: { value: date },
    });
  await user.type(
    within(form).getByLabelText(entry.origin === "quick" ? "备注" : "Note", {
      exact: true,
    }),
    "Immutable note",
  );
  return { user, form, ...rendered };
}
function recordButton(
  form: HTMLElement,
  kind: (typeof transactionTestKinds)[number],
  quick = false,
) {
  return within(form).getByRole("button", {
    name: quick
      ? kind === "income"
        ? "记录收入"
        : "记录支出"
      : kind === "internalTransfer"
        ? "Record transfer"
        : `Record ${kind}`,
  });
}

describe.each(entries)("$origin $kind submissions", (entry) => {
  it("retries only its original immutable command after edits, then allows an intentional identical new submission", async () => {
    const posts: {
      key: string | null;
      body: unknown;
      owner: string | null;
      version: string | null;
    }[] = [];
    let replay = false;
    server.use(
      http.post(
        "*/api/finance/ledgers/:ledgerId/transactions",
        async ({ request }) => {
          posts.push({
            key: request.headers.get("Idempotency-Key"),
            body: await request.json(),
            owner: request.headers.get("Finance-Submission-Owner"),
            version: request.headers.get("Finance-Command-Version"),
          });
          return replay
            ? HttpResponse.json(
                createdTransactionReceipt(posts.at(-1)!.key!, ledger.id, id),
                { status: 201 },
              )
            : HttpResponse.json({}, { status: 201 });
        },
      ),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", () =>
        HttpResponse.json(transactionTestResource(entry.kind)),
      ),
    );
    const { user, form } = await openEntry(entry);
    await user.click(recordButton(form, entry.kind, entry.origin === "quick"));
    await waitFor(() =>
      expect(
        recordButton(form, entry.kind, entry.origin === "quick"),
      ).toBeDisabled(),
    );
    await waitFor(() =>
      expect(
        within(form).getByLabelText(
          entry.origin === "quick" ? "备注" : "Note",
          { exact: true },
        ),
      ).toBeEnabled(),
    );
    expect(posts[0]).toMatchObject({
      body: transactionTestBody(entry.kind),
      owner: submissionTestUser.id,
      version: "1",
    });
    const note = within(form).getByLabelText(
      entry.origin === "quick" ? "备注" : "Note",
      { exact: true },
    );
    await user.clear(note);
    await user.type(note, "New transient draft");
    replay = true;
    if (entry.origin !== "quick")
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", {
        name:
          entry.origin === "quick"
            ? "重试原始提交"
            : "Retry original submission",
      }),
    );
    await waitFor(async () =>
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
    );
    expect(posts[1]).toEqual(posts[0]);
    if (entry.origin === "quick") {
      expect(note).toHaveValue("New transient draft");
      expect(
        recordButton(form, entry.kind, entry.origin === "quick"),
      ).toBeDisabled();
      await user.click(
        within(form).getByRole("button", {
          name: "另建一笔 Transaction",
        }),
      );
      await user.clear(note);
      await user.type(note, "Immutable note");
      await user.click(
        recordButton(form, entry.kind, entry.origin === "quick"),
      );
    } else {
      const trigger = screen.getAllByRole("button", {
        name:
          entry.origin === "transactions"
            ? "Record transaction"
            : "其他 Transaction 操作",
      })[0]!;
      await waitFor(() => expect(trigger).toBeEnabled());
      await user.click(trigger);
      await user.click(
        await screen.findByRole("menuitem", {
          name:
            entry.kind === "internalTransfer"
              ? "Internal Transfer"
              : entry.kind === "income"
                ? "Income"
                : "Expense",
        }),
      );
      const next = await screen.findByRole("dialog");
      await user.type(
        within(next).getByLabelText("Amount", { exact: true }),
        money.amount,
      );
      if (entry.kind === "internalTransfer")
        await user.selectOptions(
          within(next).getByLabelText("Destination Account"),
          accounts[1].id,
        );
      else
        await user.selectOptions(
          within(next).getByLabelText("Category", { exact: true }),
          categories[1].id,
        );
      fireEvent.change(within(next).getByLabelText("Transaction date"), {
        target: { value: date },
      });
      await user.type(
        within(next).getByLabelText("Note", { exact: true }),
        "Immutable note",
      );
      await user.click(recordButton(next, entry.kind));
    }
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2]!.key).not.toBe(posts[0]!.key);
    expect(posts[2]!.body).toEqual(posts[0]!.body);
  });

  it("keeps a generic 422 unresolved and lookup absence does not execute", async () => {
    let posts = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        posts += 1;
        return HttpResponse.json(problem, { status: 422 });
      }),
    );
    const { user, form } = await openEntry(entry);
    await user.click(recordButton(form, entry.kind, entry.origin === "quick"));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent(
        entry.origin === "quick" ? "结果未知" : "outcome is unknown",
      ),
    );
    expect(
      recordButton(form, entry.kind, entry.origin === "quick"),
    ).toBeDisabled();
    if (entry.origin !== "quick")
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", {
        name: entry.origin === "quick" ? "查询结果" : "Check outcome",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: entry.origin === "quick" ? "查询结果" : "Check outcome",
        }),
      ).toBeEnabled(),
    );
    expect(posts).toBe(1);
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    expect(
      recordButton(form, entry.kind, entry.origin === "quick"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: entry.origin === "quick" ? "确认结果" : "Acknowledge outcome",
      }),
    ).not.toBeInTheDocument();
  });

  it("resolves before a resource refresh failure and leaves the draft protected", async () => {
    server.use(
      http.post("*/api/finance/ledgers/:ledgerId/transactions", ({ request }) =>
        HttpResponse.json(
          createdTransactionReceipt(
            request.headers.get("Idempotency-Key")!,
            ledger.id,
            id,
          ),
          { status: 201 },
        ),
      ),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", async () => {
        expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
        return HttpResponse.json({}, { status: 503 });
      }),
    );
    const { user, form } = await openEntry(entry);
    await user.click(recordButton(form, entry.kind, entry.origin === "quick"));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent(
        entry.origin === "quick" ? "无法刷新" : "could not refresh",
      ),
    );
    expect(
      recordButton(form, entry.kind, entry.origin === "quick"),
    ).toBeDisabled();
    expect(
      within(form).getByLabelText(
        entry.origin === "quick" ? "金额" : "Amount",
        { exact: true },
      ),
    ).toHaveValue(money.amount);
    expect(
      screen.queryByRole("button", {
        name:
          entry.origin === "quick"
            ? "重试原始提交"
            : "Retry original submission",
      }),
    ).not.toBeInTheDocument();
    if (entry.origin !== "quick")
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", {
        name:
          entry.origin === "quick"
            ? "刷新 Transaction 列表"
            : "Refresh Transaction list",
      }),
    ).toBeEnabled();
  });
});

describe.each(transactionTestKinds)("%s evidence", (kind) => {
  it("strictly correlates receipts and exact Q29 JSON without inferring from status", async () => {
    const record = await prepareSubmission(namespace, command(kind));
    const receipt = createdTransactionReceipt(
      record.submissionId,
      ledger.id,
      id,
    );
    expect(createResponseResolution(record, receipt)?.kind).toBe("receipt");
    for (const change of [
      { submissionId: crypto.randomUUID() },
      { targetLedgerId: otherLedger.id },
      { operation: "createBalanceAdjustment" },
      { commandVersion: "2" },
      { outcome: { kind: "noChange" } },
      { outcome: { kind: "created", resource: { type: "account", id } } },
      { resolvedAt: "2026-10-02T00:00:00Z" },
    ])
      expect(
        createResponseResolution(record, { ...receipt, ...change }),
      ).toBeNull();
    const proof = {
      kind: "definitivelyNotAdmitted",
      submissionId: record.submissionId,
      commandVersion: "1",
      operation: record.operation,
      targetLedgerId: ledger.id,
      ownerId: namespace.ownerId,
      attemptedBody: record.body,
    };
    const q29 = { ...problem, errors: [], commandValidationRejection: proof };
    expect(errorResolution(record, q29)?.kind).toBe("notAdmitted");
    const changes = [
      { note: null },
      { transactionDate: "2026-10-06" },
      kind === "internalTransfer"
        ? {
            sourceAccountId: accounts[1].id,
            destinationAccountId: accounts[0].id,
          }
        : {
            categoryAllocations: [
              { amount: money, categoryId: categories[0].id },
            ],
          },
      kind === "internalTransfer"
        ? { amount: { ...money, amount: "9007199254740993.010" } }
        : { economicAmount: { ...money, amount: "9007199254740993.010" } },
    ];
    for (const change of changes)
      expect(
        errorResolution(record, {
          ...q29,
          commandValidationRejection: {
            ...proof,
            attemptedBody: { ...record.body, ...change },
          },
        }),
      ).toBeNull();
    for (const change of [
      { ownerId: crypto.randomUUID() },
      { attemptedBody: [] },
      { attemptedBody: { ...record.body, extra: null } },
    ])
      expect(
        errorResolution(record, {
          ...q29,
          commandValidationRejection: { ...proof, ...change },
        }),
      ).toBeNull();
    expect(
      errorResolution(record, { ...q29, submissionReceipt: receipt }),
    ).toBeNull();
    await blockConflictingSubmission(record);
    const blocked = (await readSubmission(record))!;
    expect(errorResolution(blocked, q29)).toBeNull();
    expect(createResponseResolution(blocked, receipt)).toBeNull();
  });

  it("reload lookup settles terminal rejection, permits acknowledgement and never posts", async () => {
    const record = await prepareSubmission(namespace, command(kind));
    let posts = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        posts += 1;
        return HttpResponse.json({});
      }),
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: rejectedTransactionReceipt(
            record.submissionId,
            ledger.id,
            problem,
          ),
        }),
      ),
    );
    const user = userEvent.setup();
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);
    await waitFor(async () =>
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
    );
    const acknowledgement = await screen.findByRole("button", {
      name: "Acknowledge outcome",
    });
    await waitFor(() => expect(acknowledgement).toBeEnabled());
    await user.click(acknowledgement);
    await waitFor(async () =>
      expect(await readSubmissions(namespace)).toEqual([]),
    );
    expect(posts).toBe(0);
    expect(
      await resolveSubmission(record, {
        kind: "receipt",
        receipt: createdTransactionReceipt(record.submissionId, ledger.id, id),
      }),
    ).toBeNull();
  });
});

it("blocks dispatch when durable preparation fails", async () => {
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
      posts += 1;
      return HttpResponse.json({});
    }),
  );
  const { user, form } = await openEntry({ kind: "expense", origin: "quick" });
  await user.click(recordButton(form, "expense", true));
  await waitFor(() =>
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "浏览器存储写入失败",
    ),
  );
  expect(posts).toBe(0);
});

it("does not retire terminal evidence when its local resolution write fails", async () => {
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  server.use(
    http.post("*/api/finance/ledgers/:ledgerId/transactions", ({ request }) =>
      HttpResponse.json(
        createdTransactionReceipt(
          request.headers.get("Idempotency-Key")!,
          ledger.id,
          id,
        ),
        { status: 201 },
      ),
    ),
  );
  const { user, form } = await openEntry({ kind: "expense", origin: "quick" });
  await user.click(recordButton(form, "expense", true));
  await waitFor(() =>
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "浏览器存储写入失败",
    ),
  );
  expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
  expect(
    screen.queryByRole("button", { name: "确认结果" }),
  ).not.toBeInTheDocument();
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it.each(["expense", "income"] as const)(
  "keeps Chinese %s validation associated with visible fields and preserves the draft",
  async (kind) => {
    let posts = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        posts += 1;
        return HttpResponse.json({});
      }),
    );
    const { user, form } = await openEntry({ kind, origin: "quick" });
    const amount = within(form).getByRole("textbox", { name: "金额" });
    const note = within(form).getByRole("textbox", { name: "备注" });
    const account = within(form).getByRole("combobox", { name: "Account" });
    const category = within(form).getByRole("combobox", { name: "Category" });
    expect(form).toHaveAttribute("lang", "zh-CN");
    expect(amount).toHaveAccessibleDescription(
      "金额币种：USD，由所选 Account 决定。 本次 Transaction 日期：2026年10月5日星期一",
    );
    expect(note).toHaveAttribute("placeholder", "选填");
    expect(
      within(category).getByRole("option", { name: "未分类" }),
    ).toHaveValue("");
    expect(
      within(category).getByRole("option", {
        name: `Travel，Category 标识 ${categories[1].id}`,
      }),
    ).toBeVisible();
    await user.clear(amount);
    await user.type(amount, "0");
    await user.click(recordButton(form, kind, true));
    expect(amount).toHaveFocus();
    expect(amount).toHaveAccessibleErrorMessage(
      "请输入大于零的普通十进制金额。",
    );
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "请输入大于零的普通十进制金额。",
    );
    expect(note).toHaveValue("Immutable note");
    expect(category).toHaveValue(categories[1].id);
    await user.clear(amount);
    await user.type(amount, "12.345");
    await user.click(recordButton(form, kind, true));
    expect(amount).toHaveAccessibleErrorMessage("USD 金额最多支持 2 位小数。");
    await user.selectOptions(account, accounts[2].id);
    await user.click(recordButton(form, kind, true));
    expect(amount).toHaveAccessibleErrorMessage("JPY 金额不能包含小数。");
    await user.clear(amount);
    await user.type(amount, "12");
    fireEvent.change(note, { target: { value: "文".repeat(501) } });
    await user.click(recordButton(form, kind, true));
    expect(note).toHaveFocus();
    expect(note).toHaveAccessibleErrorMessage("备注不能超过 500 个字符。");
    expect(amount).toHaveValue("12");
    expect(posts).toBe(0);
  },
);

it.each([
  [
    "finance_account_archived",
    "Account",
    "Account",
    "Cash",
    "请选择其他启用的 Account",
  ],
  [
    "finance_category_not_found",
    "Category",
    "Category",
    "Travel",
    "请选择其他启用的 Category 或未分类",
  ],
] as const)(
  "announces a Chinese correlated %s rejection and focuses its retained selection",
  async (code, field, domain, name, guidance) => {
    server.use(
      http.post(
        "*/api/finance/ledgers/:ledgerId/transactions",
        ({ request }) => {
          const rejection = {
            ...problem,
            code,
            status: code.endsWith("not_found") ? 404 : 409,
          };
          return HttpResponse.json(
            {
              ...rejection,
              submissionReceipt: rejectedTransactionReceipt(
                request.headers.get("Idempotency-Key")!,
                ledger.id,
                rejection,
              ),
            },
            { status: rejection.status },
          );
        },
      ),
    );
    const { user, form } = await openEntry({
      kind: "expense",
      origin: "quick",
    });
    await user.click(recordButton(form, "expense", true));
    const selection = within(form).getByRole("combobox", { name: field });
    await waitFor(() => expect(selection).toHaveFocus());
    expect(selection).toHaveAccessibleErrorMessage(
      new RegExp(`所选 ${domain}.*${name}.*${guidance}`),
    );
    expect(
      within(selection).getByRole("option", { name: /不可用/ }),
    ).toBeDisabled();
    expect(within(form).getByRole("textbox", { name: "金额" })).toHaveValue(
      money.amount,
    );
    expect(within(form).getByRole("textbox", { name: "备注" })).toHaveValue(
      "Immutable note",
    );
    expect(
      screen.getByRole("status", { name: /^Transaction 创建被拒绝:/ }),
    ).toHaveAttribute("lang", "zh-CN");
  },
);

it.each(["user", "replacement", "deletion"] as const)(
  "does not project a delayed current resource across %s state",
  async (change) => {
    const record = await prepareSubmission(namespace, command("expense"));
    const started = gate();
    const held = gate();
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: createdTransactionReceipt(
            record.submissionId,
            ledger.id,
            id,
          ),
        }),
      ),
      http.get("*/api/finance/ledgers/:ledgerId/transactions/:id", async () => {
        started.release();
        await held.promise;
        return HttpResponse.json(transactionTestResource("expense"));
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/accounts?ledger=${ledger.id}`,
    );
    const historyKey = [
      ...getListFinanceTransactionsQueryKey(ledger.id),
      "infinite",
    ];
    queryClient.setQueryData(historyKey, {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [undefined],
    });
    await started.promise;
    if (change === "user") {
      const other = { ...submissionTestUser, id: crypto.randomUUID() };
      server.use(getGetCurrentUserMockHandler(other));
      await act(async () =>
        queryClient.setQueryData(getGetCurrentUserQueryKey(), {
          data: other,
          status: 200,
          headers: new Headers(),
        }),
      );
    } else if (change === "replacement") {
      claimReplacement(replacementKey(ledger.id, id));
      releaseReplacement(replacementKey(ledger.id, id));
    } else
      await act(async () =>
        settleTransactionDeletion(
          queryClient,
          transactionTestResource("expense"),
          "deleted",
        ),
      );
    held.release();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Check outcome" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(historyKey)).toMatchObject({
        pages: [{ items: [] }],
      }),
    );
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
  },
);

it("uses the separately read current Transaction in existing histories, never the submitted draft or a receipt snapshot", async () => {
  const record = await prepareSubmission(namespace, command("expense"));
  server.use(
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json({
        state: "terminal",
        receipt: createdTransactionReceipt(record.submissionId, ledger.id, id),
      }),
    ),
  );
  const { queryClient } = renderRoute(
    `/finance/accounts?ledger=${otherLedger.id}`,
  );
  const historyKey = [
    ...getListFinanceTransactionsQueryKey(ledger.id),
    "infinite",
  ];
  queryClient.setQueryData(historyKey, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  });
  await waitFor(() =>
    expect(queryClient.getQueryData(historyKey)).toMatchObject({
      pages: [{ items: [{ id, note: "Current edited note" }] }],
    }),
  );
  expect(
    queryClient.getQueriesData({
      queryKey: getListFinanceTransactionsQueryKey(otherLedger.id),
    }),
  ).toEqual([]);
});

it("keeps the retargeted Quick Entry draft when a delayed original create completes", async () => {
  const held = gate();
  const started = gate();
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledgerId/transactions",
      async ({ request }) => {
        started.release();
        await held.promise;
        return HttpResponse.json(
          createdTransactionReceipt(
            request.headers.get("Idempotency-Key")!,
            ledger.id,
            id,
          ),
          { status: 201 },
        );
      },
    ),
    http.get("*/api/finance/ledgers/:ledgerId/overview/day", ({ request }) =>
      HttpResponse.json({
        ...transactionTestDay,
        date: new URL(request.url).searchParams.get("date"),
      }),
    ),
  );
  const { user, form, router } = await openEntry({
    kind: "expense",
    origin: "quick",
  });
  await user.click(recordButton(form, "expense", true));
  await started.promise;
  await act(async () =>
    router.navigate(
      `/finance/overview?ledger=${ledger.id}&month=2026-10&date=2026-10-06`,
    ),
  );
  held.release();
  await waitFor(async () =>
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
  );
  await waitFor(() =>
    expect(within(form).getByLabelText("备注", { exact: true })).toBeEnabled(),
  );
  expect(within(form).getByLabelText("金额", { exact: true })).toHaveValue(
    money.amount,
  );
  expect(within(form).getByLabelText("备注", { exact: true })).toHaveValue(
    "Immutable note",
  );
  expect(recordButton(form, "expense", true)).toBeDisabled();
  expect((await readSubmissions(namespace))[0]).toMatchObject({
    body: { transactionDate: date },
  });
});

it("does not close or clear a reopened workflow after navigation abandons its pending create", async () => {
  const held = gate();
  const started = gate();
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledgerId/transactions",
      async ({ request }) => {
        started.release();
        await held.promise;
        return HttpResponse.json(
          createdTransactionReceipt(
            request.headers.get("Idempotency-Key")!,
            ledger.id,
            id,
          ),
          { status: 201 },
        );
      },
    ),
  );
  const { user, form, router } = await openEntry({
    kind: "expense",
    origin: "transactions",
  });
  await user.click(recordButton(form, "expense"));
  await started.promise;
  await act(async () =>
    router.navigate(`/finance/accounts?ledger=${ledger.id}`),
  );
  held.release();
  await waitFor(async () =>
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
  );
  await act(async () =>
    router.navigate(`/finance/transactions?ledger=${ledger.id}`),
  );
  const trigger = await screen.findByRole("button", {
    name: "Record transaction",
  });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
  const reopened = await screen.findByRole("dialog");
  await user.type(
    within(reopened).getByLabelText("Note", { exact: true }),
    "New workflow",
  );
  expect(reopened).toBeVisible();
  expect(within(reopened).getByLabelText("Note", { exact: true })).toHaveValue(
    "New workflow",
  );
});
