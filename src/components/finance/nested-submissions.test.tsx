import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBObjectStore } from "fake-indexeddb";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getListFinanceAccountsQueryKey,
  getListFinanceCategoriesQueryKey,
  getGetCurrentUserQueryKey,
} from "@/api/generated/core-console";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceCurrenciesMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceCategoriesMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import {
  createdAccountReceipt,
  createdCategoryReceipt,
  rejectedNestedProblem,
  submissionTestUser,
} from "@/test/submission-fixtures";
import {
  prepareSubmission,
  readSubmissions,
  blockConflictingSubmission,
  type CreateSubmissionCommand,
} from "./submission-journal";
import {
  errorResolution,
  createResponseResolution,
} from "./submission-evidence";

const ledger = { id: "11111111-1111-4111-8111-111111111111", name: "Personal" };
const otherLedger = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Team",
};
const resourceId = "22222222-2222-4222-8222-222222222222";
const namespace = {
  apiBaseUrl: "http://localhost/api",
  ownerId: submissionTestUser.id,
};
const accountBody = {
  name: "Reserve",
  currency: "CNY",
  nature: "liability",
  openingBalance: { amount: "-9007199254740993.01", currency: "CNY" },
  trackingStartDate: "2026-10-05",
} as const;
const cases = [
  {
    operation: "createFinanceAccount",
    label: "Account",
    slug: "accounts",
    command: {
      operation: "createFinanceAccount",
      workflow: "account",
      targetLedgerId: ledger.id,
      body: accountBody,
    },
    receipt: createdAccountReceipt,
  },
  {
    operation: "createFinanceCategory",
    label: "Category",
    slug: "categories",
    command: {
      operation: "createFinanceCategory",
      workflow: "category",
      targetLedgerId: ledger.id,
      body: { name: "Reserve" },
    },
    receipt: createdCategoryReceipt,
  },
] satisfies {
  operation: "createFinanceAccount" | "createFinanceCategory";
  label: string;
  slug: string;
  command: CreateSubmissionCommand;
  receipt: typeof createdAccountReceipt | typeof createdCategoryReceipt;
}[];
const problem = {
  type: "about:blank",
  title: "Validation Error",
  status: 422,
  code: "validation_error",
};

beforeEach(() => {
  localStorage.clear();
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger, otherLedger]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    getListFinanceAccountsMockHandler([]),
    getListFinanceCategoriesMockHandler([]),
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json(
        { ...problem, status: 404, code: "finance_submission_not_found" },
        { status: 404 },
      ),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());

async function openForm(value: (typeof cases)[number]) {
  const user = userEvent.setup();
  const rendered = renderRoute(`/finance/${value.slug}?ledger=${ledger.id}`);
  await user.click(
    await screen.findByRole(
      "button",
      {
        name: `Create ${value.label.toLowerCase()}`,
      },
      { timeout: 5000 },
    ),
  );
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText(`${value.label} name`),
    "Reserve",
  );
  if (value.operation === "createFinanceAccount") {
    await user.selectOptions(
      within(dialog).getByLabelText("Nature"),
      "liability",
    );
    const amount = within(dialog).getByLabelText("Opening balance");
    await user.clear(amount);
    await user.type(amount, accountBody.openingBalance.amount);
    const date = within(dialog).getByLabelText("Tracking start date");
    await user.clear(date);
    await user.type(date, accountBody.trackingStartDate);
  }
  await user.click(
    within(dialog).getByRole("button", {
      name: `Create ${value.label.toLowerCase()}`,
    }),
  );
  return { user, dialog, ...rendered };
}

describe.each(cases)("$label durable form creates", (value) => {
  it("guards a delayed terminal lookup across Current User changes and retains its original partition", async () => {
    const record = await prepareSubmission(namespace, value.command);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/finance/submissions/:id", async () => {
        entered();
        await held;
        return HttpResponse.json({
          state: "terminal",
          receipt: value.receipt(record.submissionId, ledger.id, resourceId),
        });
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/${value.slug}?ledger=${ledger.id}`,
    );
    await started;
    const listKey =
      value.operation === "createFinanceAccount"
        ? getListFinanceAccountsQueryKey
        : getListFinanceCategoriesQueryKey;
    await waitFor(() =>
      expect(queryClient.getQueryData(listKey(ledger.id))).toMatchObject({
        data: [],
      }),
    );
    const other = { ...submissionTestUser, id: crypto.randomUUID() };
    server.use(getGetCurrentUserMockHandler(other));
    await act(async () => {
      queryClient.setQueryData(getGetCurrentUserQueryKey(), {
        data: other,
        status: 200,
        headers: new Headers(),
      });
    });
    release();
    await waitFor(async () =>
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
    );
    expect(
      screen.queryByText(`${value.label} created:`, { exact: false }),
    ).not.toBeInTheDocument();
    expect(await readSubmissions({ ...namespace, ownerId: other.id })).toEqual(
      [],
    );
    expect(queryClient.getQueryData(listKey(ledger.id))).toMatchObject({
      data: [],
    });
  });

  it("cannot associate receipt or Q29 after known conflicting reuse", async () => {
    const record = await prepareSubmission(namespace, value.command);
    await blockConflictingSubmission(record);
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: value.receipt(record.submissionId, ledger.id, resourceId),
        }),
      ),
    );
    renderRoute(`/finance/${value.slug}?ledger=${ledger.id}`);
    const status = await screen.findByRole("status", {
      name: `${value.label} outcome unknown: Reserve`,
    });
    await within(status).findByText(/evidence does not match/);
    expect(
      within(status).getByRole("button", { name: "Retry original submission" }),
    ).toBeDisabled();
    const [stored] = await readSubmissions(namespace);
    expect(stored).toMatchObject({
      state: "unresolved",
      integrityBlocked: true,
    });
    expect(
      errorResolution(stored!, {
        ...problem,
        errors: [],
        commandValidationRejection: {
          kind: "definitivelyNotAdmitted",
          ownerId: record.ownerId,
          submissionId: record.submissionId,
          operation: record.operation,
          commandVersion: "1",
          targetLedgerId: record.targetLedgerId,
          attemptedBody: record.body,
        },
      }),
    ).toBeNull();
  });

  it("does not close a reopened workflow when its earlier create finishes", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(
        `*/api/finance/ledgers/:ledgerId/${value.slug}`,
        async ({ request }) => {
          await held;
          return HttpResponse.json(
            value.receipt(
              request.headers.get("Idempotency-Key")!,
              ledger.id,
              resourceId,
            ),
            { status: 201 },
          );
        },
      ),
    );
    const { router, user } = await openForm(value);
    await act(() =>
      router.navigate(`/finance/${value.slug}?ledger=${otherLedger.id}`),
    );
    await user.click(
      await screen.findByRole("button", {
        name: `Create ${value.label.toLowerCase()}`,
      }),
    );
    const laterDialog = screen.getByRole("dialog");
    const laterDraft = within(laterDialog).getByLabelText(
      `${value.label} name`,
    );
    await user.type(laterDraft, "Separate work");
    release();
    await waitFor(async () =>
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
    );
    expect(laterDialog).toBeVisible();
    expect(laterDraft).toHaveValue("Separate work");
    expect(laterDraft).toHaveFocus();
  });

  it("retains edits as drafts and retries the original command after closing and switching Ledgers", async () => {
    const posts: {
      body: unknown;
      key: string | null;
      owner: string | null;
      version: string | null;
      path: string;
    }[] = [];
    server.use(
      http.post(
        `*/api/finance/ledgers/:ledgerId/${value.slug}`,
        async ({ request }) => {
          const sent = {
            body: await request.json(),
            key: request.headers.get("Idempotency-Key"),
            owner: request.headers.get("Finance-Submission-Owner"),
            version: request.headers.get("Finance-Command-Version"),
            path: new URL(request.url).pathname,
          };
          posts.push(sent);
          return HttpResponse.json(
            posts.length === 1
              ? {}
              : value.receipt(sent.key!, ledger.id, resourceId),
            { status: 201 },
          );
        },
      ),
    );
    const { user, dialog, router, queryClient } = await openForm(value);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "outcome is unknown",
    );
    const draft = within(dialog).getByLabelText(`${value.label} name`);
    await user.clear(draft);
    await user.type(draft, "Edited draft");
    expect(
      within(dialog).getByRole("button", {
        name: `Create ${value.label.toLowerCase()}`,
      }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(() =>
      router.navigate(`/finance/${value.slug}?ledger=${otherLedger.id}`),
    );
    const region = await screen.findByRole("region", {
      name: "Finance submission recovery",
    });
    await within(region).findByText(/Recovery could not complete/);
    const retry = within(region).getByRole("button", {
      name: "Retry original submission",
    });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await screen.findByRole("status", {
      name: `${value.label} created: Reserve`,
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]).toMatchObject({
      body: value.command.body,
      owner: submissionTestUser.id,
      version: "1",
      path: `/api/finance/ledgers/${ledger.id}/${value.slug}`,
    });
    const listKey =
      value.operation === "createFinanceAccount"
        ? getListFinanceAccountsQueryKey
        : getListFinanceCategoriesQueryKey;
    expect(queryClient.getQueryData(listKey(otherLedger.id))).toMatchObject({
      data: [],
    });
    expect(await readSubmissions(namespace)).toMatchObject([
      { targetLedgerId: ledger.id, state: "resolved" },
    ]);
    await user.click(
      within(region).getByRole("button", { name: "Acknowledge outcome" }),
    );
    await waitFor(async () =>
      expect(await readSubmissions(namespace)).toEqual([]),
    );
  });

  it("allows a corrected draft only after correlated Q29 has been stored, with a fresh identity", async () => {
    const posts: string[] = [];
    server.use(
      http.post(
        `*/api/finance/ledgers/:ledgerId/${value.slug}`,
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          posts.push(key);
          return HttpResponse.json(
            {
              ...problem,
              errors: [],
              commandValidationRejection: {
                kind: "definitivelyNotAdmitted",
                ownerId: submissionTestUser.id,
                submissionId: key,
                commandVersion: "1",
                operation: value.operation,
                targetLedgerId: ledger.id,
                attemptedBody: await request.json(),
              },
            },
            { status: 422 },
          );
        },
      ),
    );
    const { user, dialog } = await openForm(value);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "not admitted",
    );
    expect((await readSubmissions(namespace))[0]).toMatchObject({
      state: "resolved",
      resolution: { kind: "notAdmitted" },
    });
    const draft = within(dialog).getByLabelText(`${value.label} name`);
    await user.clear(draft);
    await user.type(draft, "Corrected draft");
    await user.click(
      within(dialog).getByRole("button", {
        name: `Create ${value.label.toLowerCase()}`,
      }),
    );
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).not.toBe(posts[0]);
    expect(draft).toHaveValue("Corrected draft");
  });

  it("keeps generic validation unresolved and does not disclose server detail", async () => {
    server.use(
      http.post(`*/api/finance/ledgers/:ledgerId/${value.slug}`, () =>
        HttpResponse.json(
          { ...problem, detail: "private persistence detail" },
          { status: 422 },
        ),
      ),
    );
    const { dialog } = await openForm(value);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "outcome is unknown",
    );
    expect(dialog).not.toHaveTextContent("private persistence detail");
    expect(
      within(dialog).getByRole("button", {
        name: `Create ${value.label.toLowerCase()}`,
      }),
    ).toBeDisabled();
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
  });

  it("recovers terminal business rejection through lookup without posting", async () => {
    const record = await prepareSubmission(namespace, value.command);
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: rejectedNestedProblem(
            value.operation,
            record.submissionId,
            ledger.id,
          ).submissionReceipt,
        }),
      ),
    );
    const { user } = {
      user: userEvent.setup(),
      ...renderRoute(`/finance/${value.slug}?ledger=${otherLedger.id}`),
    };
    const status = await screen.findByRole("status", {
      name: `${value.label} create rejected: Reserve`,
    });
    expect(
      within(status).queryByRole("button", {
        name: "Retry original submission",
      }),
    ).not.toBeInTheDocument();
    expect((await readSubmissions(namespace))[0]).toMatchObject({
      state: "resolved",
      resolution: {
        kind: "receipt",
        receipt: { outcome: { kind: "rejected" } },
      },
    });
    await user.click(
      within(status).getByRole("button", { name: "Acknowledge outcome" }),
    );
    await waitFor(async () =>
      expect(await readSubmissions(namespace)).toEqual([]),
    );
  });

  it("blocks network dispatch when durable preparation fails", async () => {
    let posts = 0;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    server.use(
      http.post(`*/api/finance/ledgers/:ledgerId/${value.slug}`, () => {
        posts += 1;
        return HttpResponse.json({});
      }),
    );
    const { dialog } = await openForm(value);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "storage write failed",
    );
    expect(posts).toBe(0);
    expect(await readSubmissions(namespace)).toEqual([]);
  });

  it("retains unresolved evidence when local resolution fails and later lookup resolves it", async () => {
    let key = "";
    server.use(
      http.post(
        `*/api/finance/ledgers/:ledgerId/${value.slug}`,
        ({ request }) => {
          key = request.headers.get("Idempotency-Key")!;
          return HttpResponse.json(value.receipt(key, ledger.id, resourceId), {
            status: 201,
          });
        },
      ),
    );
    const failure = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    const { user, dialog, router } = await openForm(value);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "storage write failed",
    );
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    failure.mockRestore();
    server.use(
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: value.receipt(key, ledger.id, resourceId),
        }),
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(() =>
      router.navigate(`/finance/${value.slug}?ledger=${otherLedger.id}`),
    );
    expect(
      await screen.findByRole("status", {
        name: `${value.label} created: Reserve`,
      }),
    ).toHaveTextContent("creation is confirmed");
  });

  it("keeps the submitted command resolved during list failure, without clearing later edits or stealing focus", async () => {
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(
        `*/api/finance/ledgers/:ledgerId/${value.slug}`,
        async ({ request }) => {
          await response;
          return HttpResponse.json(
            value.receipt(
              request.headers.get("Idempotency-Key")!,
              ledger.id,
              resourceId,
            ),
            { status: 201 },
          );
        },
      ),
    );
    const { user, dialog } = await openForm(value);
    const draft = within(dialog).getByLabelText(`${value.label} name`);
    await user.clear(draft);
    await user.type(draft, "Later edit");
    server.use(
      http.get(`*/api/finance/ledgers/:ledgerId/${value.slug}`, () =>
        HttpResponse.json({ ...problem, status: 503 }, { status: 503 }),
      ),
    );
    release();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "creation is confirmed",
    );
    expect(draft).toHaveValue("Later edit");
    expect(draft).toHaveFocus();
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
    expect(
      within(dialog).getByRole("button", {
        name: `Create ${value.label.toLowerCase()}`,
      }),
    ).toBeDisabled();
  });

  it.each(["owner", "key", "version", "operation", "scope", "body", "both"])(
    "rejects mismatched Q29 %s evidence",
    async (mismatch) => {
      const record = await prepareSubmission(namespace, value.command);
      const proof = {
        kind: "definitivelyNotAdmitted",
        ownerId: record.ownerId,
        submissionId: record.submissionId,
        commandVersion: "1",
        operation: record.operation,
        targetLedgerId: record.targetLedgerId,
        attemptedBody: record.body,
      };
      const invalid = {
        ...problem,
        errors: [],
        commandValidationRejection: {
          ...proof,
          ...(mismatch === "owner" ? { ownerId: crypto.randomUUID() } : {}),
          ...(mismatch === "key" ? { submissionId: crypto.randomUUID() } : {}),
          ...(mismatch === "version" ? { commandVersion: "2" } : {}),
          ...(mismatch === "operation"
            ? { operation: "createFinanceLedger", targetLedgerId: null }
            : {}),
          ...(mismatch === "scope" ? { targetLedgerId: otherLedger.id } : {}),
          ...(mismatch === "body"
            ? { attemptedBody: { ...record.body, name: "Other" } }
            : {}),
        },
        ...(mismatch === "both"
          ? {
              submissionReceipt: value.receipt(
                record.submissionId,
                ledger.id,
                resourceId,
              ),
            }
          : {}),
      };
      expect(errorResolution(record, invalid)).toBeNull();
      expect(
        errorResolution(record, {
          ...problem,
          errors: [],
          commandValidationRejection: proof,
        })?.kind,
      ).toBe("notAdmitted");
      expect(
        createResponseResolution(record, {
          ...value.receipt(record.submissionId, ledger.id, resourceId),
          targetLedgerId: otherLedger.id,
        }),
      ).toBeNull();
    },
  );
});

it("creates an intentionally identical Account with a fresh key through an explicit separate-create action", async () => {
  const keys: string[] = [];
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledgerId/accounts",
      async ({ request }) => {
        expect(await request.json()).toEqual(accountBody);
        keys.push(request.headers.get("Idempotency-Key")!);
        return HttpResponse.json({}, { status: 201 });
      },
    ),
  );
  const value = cases[0]!;
  const { user, dialog } = await openForm(value);
  await within(dialog).findByRole("alert");
  await user.click(
    within(dialog).getByRole("button", {
      name: "Start a separate Account create",
    }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Create account" }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);
  expect(await readSubmissions(namespace)).toHaveLength(2);
});

it("preserves invalid and boundary Money as strings for exact Q29 attempted-body comparison", async () => {
  for (const amount of [
    "-0.00",
    "00010.00",
    "1.000",
    "9".repeat(131072),
    "9".repeat(131073),
  ]) {
    const record = await prepareSubmission(namespace, {
      operation: "createFinanceAccount",
      workflow: "account",
      targetLedgerId: ledger.id,
      body: { ...accountBody, openingBalance: { amount, currency: "CNY" } },
    });
    const proof = {
      kind: "definitivelyNotAdmitted",
      ownerId: record.ownerId,
      submissionId: record.submissionId,
      commandVersion: "1",
      operation: record.operation,
      targetLedgerId: record.targetLedgerId,
      attemptedBody: record.body,
    };
    expect(
      errorResolution(record, {
        ...problem,
        errors: [],
        commandValidationRejection: proof,
      })?.kind,
    ).toBe("notAdmitted");
    expect(
      errorResolution(record, {
        ...problem,
        errors: [],
        commandValidationRejection: {
          ...proof,
          attemptedBody: {
            ...accountBody,
            openingBalance: { amount: 0, currency: "CNY" },
          },
        },
      }),
    ).toBeNull();
  }
});
