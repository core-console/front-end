import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBObjectStore } from "fake-indexeddb";

import {
  getGetCurrentUserQueryKey,
  getListFinanceLedgersQueryKey,
} from "@/api/generated/core-console";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import {
  createdLedgerReceipt,
  rejectedLedgerProblem,
  submissionTestUser,
} from "@/test/submission-fixtures";
import {
  prepareLedgerSubmission,
  readSubmissions,
  resolveSubmission,
} from "./submission-journal";

const namespace = {
  apiBaseUrl: "http://localhost/api",
  ownerId: submissionTestUser.id,
};
const ledger = {
  id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
  name: "Household",
};
const unknownProblem = {
  type: "about:blank",
  title: "Unknown outcome",
  status: 503,
  code: "temporarily_unavailable",
};
const absentProblem = {
  type: "about:blank",
  title: "Not found",
  status: 404,
  code: "finance_submission_not_found",
};

beforeEach(() => {
  localStorage.clear();
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([]),
    http.get("*/api/finance/submissions/:id", () =>
      HttpResponse.json(absentProblem, { status: 404 }),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());

async function createFirst() {
  const user = userEvent.setup();
  const rendered = renderRoute("/finance/categories");
  const name = await screen.findByLabelText("Ledger name");
  await user.clear(name);
  await user.type(name, "Household");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create Ledger" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Create Ledger" }));
  return { user, name, ...rendered };
}

describe("Ledger submitted recovery", () => {
  it("retains unknown outcomes through navigation and retries the original headers and body after draft edits", async () => {
    const sent: {
      body: unknown;
      key: string | null;
      owner: string | null;
      version: string | null;
    }[] = [];
    let ledgers: (typeof ledger)[] = [];
    server.use(
      getListFinanceLedgersMockHandler(() => ledgers),
      http.post("*/api/finance/ledgers", async ({ request }) => {
        sent.push({
          body: await request.json(),
          key: request.headers.get("Idempotency-Key"),
          owner: request.headers.get("Finance-Submission-Owner"),
          version: request.headers.get("Finance-Command-Version"),
        });
        if (sent.length === 1)
          return HttpResponse.json(unknownProblem, { status: 503 });
        ledgers = [ledger];
        return HttpResponse.json(
          createdLedgerReceipt(sent[0]!.key!, ledger.id),
          { status: 201 },
        );
      }),
    );
    const { user, name, router } = await createFirst();
    await screen.findByText(/The Ledger outcome is unknown/);
    await user.clear(name);
    await user.type(name, "Separate edited draft");
    expect(
      screen.getByRole("button", { name: "Create Ledger" }),
    ).toBeDisabled();
    await act(() => router.navigate("/finance/accounts"));
    await screen.findByRole("status", {
      name: "Ledger outcome unknown: Household",
    });
    await within(
      screen.getByRole("region", { name: "Finance submission recovery" }),
    ).findByText(/Recovery could not complete/);
    expect(sent).toHaveLength(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry original submission" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry original submission" }),
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    await screen.findByRole("status", { name: "Ledger created: Household" });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({
      body: { name: "Household" },
      owner: submissionTestUser.id,
      version: "1",
    });
    const [record] = await readSubmissions(namespace);
    expect(record?.state).toBe("resolved");
  });

  it.each([
    "generic422",
    "wrongReceipt",
    "wrongProofBody",
    "wrongProofOwner",
    "bothEvidence",
  ])(
    "retains uncertainty for $0 instead of resolving from status",
    async (kind) => {
      server.use(
        http.post("*/api/finance/ledgers", async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          if (kind === "wrongReceipt")
            return HttpResponse.json(
              createdLedgerReceipt(crypto.randomUUID(), ledger.id),
              { status: 201 },
            );
          const evidence = {
            kind: "definitivelyNotAdmitted",
            submissionId: key,
            commandVersion: "1",
            ownerId:
              kind === "wrongProofOwner"
                ? crypto.randomUUID()
                : submissionTestUser.id,
            operation: "createFinanceLedger",
            targetLedgerId: null,
            attemptedBody:
              kind === "wrongProofBody"
                ? { name: "Different" }
                : { name: "Household" },
          };
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Validation failed",
              code: "validation_error",
              status: 422,
              ...(kind === "generic422"
                ? {}
                : { errors: [], commandValidationRejection: evidence }),
              ...(kind === "bothEvidence"
                ? {
                    submissionReceipt:
                      rejectedLedgerProblem(key).submissionReceipt,
                  }
                : {}),
            },
            { status: 422 },
          );
        }),
      );
      const { user } = await createFirst();
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: "Start a separate Ledger create",
          }),
        ).toBeEnabled(),
      );
      expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
      expect(
        screen.queryByRole("button", { name: "Acknowledge outcome" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create Ledger" }),
      ).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Check outcome" }));
      expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    },
  );

  it("durably resolves correlated Q29 proof and uses a fresh identity for explicitly corrected content", async () => {
    const keys: string[] = [];
    server.use(
      http.post("*/api/finance/ledgers", async ({ request }) => {
        const body = await request.json();
        const key = request.headers.get("Idempotency-Key")!;
        keys.push(key);
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Validation failed",
            code: "validation_error",
            status: 422,
            errors: [],
            commandValidationRejection: {
              kind: "definitivelyNotAdmitted",
              submissionId: key,
              commandVersion: "1",
              ownerId: submissionTestUser.id,
              operation: "createFinanceLedger",
              targetLedgerId: null,
              attemptedBody: body,
            },
          },
          { status: 422 },
        );
      }),
    );
    const { user, name } = await createFirst();
    await screen.findByRole("status", {
      name: "Command not admitted: Household",
    });
    expect((await readSubmissions(namespace))[0]).toMatchObject({
      state: "resolved",
      resolution: { kind: "notAdmitted" },
    });
    await user.clear(name);
    await user.type(name, "Corrected");
    await user.click(screen.getByRole("button", { name: "Create Ledger" }));
    await screen.findByRole("status", {
      name: "Command not admitted: Corrected",
    });
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("resolves a rejected terminal lookup at HTTP 200 without executing a create", async () => {
    const record = await prepareLedgerSubmission(
      namespace,
      { name: "Household" },
      "onboarding",
    );
    const post = vi.fn();
    server.use(
      http.post("*/api/finance/ledgers", () => {
        post();
        return HttpResponse.error();
      }),
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({
          state: "terminal",
          receipt: rejectedLedgerProblem(record.submissionId).submissionReceipt,
        }),
      ),
    );
    const user = userEvent.setup();
    renderRoute("/finance/accounts");
    await screen.findByRole("status", {
      name: "Ledger create rejected: Household",
    });
    expect(post).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Acknowledge outcome" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Acknowledge outcome" }),
      ).not.toBeInTheDocument(),
    );
    expect(await readSubmissions(namespace)).toEqual([]);
  });

  it("keeps success resolved when resource refresh fails and offers only explicit separate creation", async () => {
    let created = false;
    server.use(
      http.get("*/api/finance/ledgers", () =>
        created
          ? HttpResponse.json(unknownProblem, { status: 503 })
          : HttpResponse.json([]),
      ),
      http.post("*/api/finance/ledgers", ({ request }) => {
        created = true;
        return HttpResponse.json(
          createdLedgerReceipt(
            request.headers.get("Idempotency-Key")!,
            ledger.id,
          ),
          { status: 201 },
        );
      }),
    );
    await createFirst();
    await screen.findByText(/Your Ledger list could not refresh/);
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Ledger" }),
    ).toBeDisabled();
  });

  it("retains pending evidence after a local resolution write fails, then safely resolves through lookup", async () => {
    let receipt: ReturnType<typeof createdLedgerReceipt>;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });
    server.use(
      http.post("*/api/finance/ledgers", ({ request }) => {
        receipt = createdLedgerReceipt(
          request.headers.get("Idempotency-Key")!,
          ledger.id,
        );
        return HttpResponse.json(receipt, { status: 201 });
      }),
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json({ state: "terminal", receipt }),
      ),
    );
    const { user } = await createFirst();
    await within(
      screen.getByRole("region", { name: "Finance submission recovery" }),
    ).findByText(/Browser storage write failed/);
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    put.mockRestore();
    await user.click(screen.getByRole("button", { name: "Check outcome" }));
    await screen.findByRole("status", { name: "Ledger created: Household" });
    expect((await readSubmissions(namespace))[0]?.state).toBe("resolved");
  });

  it("hides the previous namespace and guards late terminal callbacks from current-user UI and resource cache", async () => {
    const record = await prepareLedgerSubmission(
      namespace,
      { name: "Household" },
      "onboarding",
    );
    let entered!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/finance/submissions/:id", async () => {
        entered();
        await pending;
        return HttpResponse.json({
          state: "terminal",
          receipt: createdLedgerReceipt(record.submissionId, ledger.id),
        });
      }),
    );
    const { queryClient } = renderRoute("/finance/accounts");
    await requestStarted;
    const other = {
      ...submissionTestUser,
      id: "22222222-2222-4222-8222-222222222222",
    };
    server.use(getGetCurrentUserMockHandler(other));
    await act(async () => {
      queryClient.setQueryData(getGetCurrentUserQueryKey(), {
        data: other,
        status: 200,
        headers: new Headers(),
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: /Household/ }),
      ).not.toBeInTheDocument(),
    );
    release();
    await waitFor(async () =>
      expect((await readSubmissions(namespace))[0]?.state).toBe("resolved"),
    );
    expect(screen.queryByText(/Ledger created:/)).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(getListFinanceLedgersQueryKey()),
    ).toMatchObject({ data: [] });
    expect(await readSubmissions({ ...namespace, ownerId: other.id })).toEqual(
      [],
    );
  });

  it("blocks dispatch when preparation storage is unavailable", async () => {
    const post = vi.fn();
    server.use(
      http.post("*/api/finance/ledgers", () => {
        post();
        return HttpResponse.error();
      }),
    );
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    renderRoute("/finance/overview");
    expect(
      await screen.findByText(/Recovery could not complete/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create Ledger" }),
    ).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each(["malformedJson", "malformedReceipt"])(
    "uses safe recovery feedback for %s lookup responses",
    async (kind) => {
      await prepareLedgerSubmission(
        namespace,
        { name: "Household" },
        "onboarding",
      );
      server.use(
        http.get("*/api/finance/submissions/:id", () =>
          kind === "malformedJson"
            ? new HttpResponse('{"private_backend_detail":', {
                headers: { "Content-Type": "application/json" },
              })
            : HttpResponse.json({ state: "terminal", receipt: {} }),
        ),
      );
      renderRoute("/finance/accounts");
      const recovery = await screen.findByRole("region", {
        name: "Finance submission recovery",
      });
      await within(recovery).findByText(/Recovery could not complete/);
      expect(recovery).not.toHaveTextContent(
        /private_backend_detail|invalid_type|expected|submissionId/,
      );
      expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    },
  );

  it("clears unknown feedback when another tab durably resolves the submission", async () => {
    server.use(
      http.post("*/api/finance/ledgers", () =>
        HttpResponse.json(unknownProblem, { status: 503 }),
      ),
    );
    await createFirst();
    const recovery = screen.getByRole("region", {
      name: "Finance submission recovery",
    });
    await within(recovery).findByText(/The Ledger outcome is unknown/);
    const [record] = await readSubmissions(namespace);
    await act(async () => {
      await resolveSubmission(record!, {
        kind: "receipt",
        receipt: createdLedgerReceipt(record!.submissionId, ledger.id),
      });
    });
    const outcome = await within(recovery).findByRole("status", {
      name: "Ledger created: Household",
    });
    expect(outcome).not.toHaveTextContent(
      /outcome is unknown|retry the original/i,
    );
    expect(
      within(outcome).queryByRole("button", {
        name: "Retry original submission",
      }),
    ).not.toBeInTheDocument();
  });

  it("starts a new user's form lifetime while an old user's dispatch is pending", async () => {
    const other = {
      ...submissionTestUser,
      id: "22222222-2222-4222-8222-222222222222",
    };
    let enterA!: () => void;
    const enteredA = new Promise<void>((resolve) => {
      enterA = resolve;
    });
    let finishA!: () => void;
    const finishedA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    let releaseA!: () => void;
    const pendingA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let enterB!: () => void;
    const enteredB = new Promise<void>((resolve) => {
      enterB = resolve;
    });
    let releaseB!: () => void;
    const pendingB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    server.use(
      http.post("*/api/finance/ledgers", async ({ request }) => {
        if (
          request.headers.get("Finance-Submission-Owner") === namespace.ownerId
        ) {
          enterA();
          await pendingA;
          finishA();
        } else {
          enterB();
          await pendingB;
        }
        return HttpResponse.json(unknownProblem, { status: 503 });
      }),
    );
    const { user, queryClient } = await createFirst();
    await enteredA;
    server.use(getGetCurrentUserMockHandler(other));
    await act(async () => {
      queryClient.setQueryData(getGetCurrentUserQueryKey(), {
        data: other,
        status: 200,
        headers: new Headers(),
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create Ledger" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Start a separate Ledger create" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create Ledger" }));
    await enteredB;
    await act(async () => {
      releaseA();
      await finishedA;
    });
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(
      screen.queryByText(/The Ledger outcome is unknown/),
    ).not.toBeInTheDocument();
    releaseB();
    await screen.findByRole("button", {
      name: "Start a separate Ledger create",
    });
    expect((await readSubmissions(namespace))[0]?.state).toBe("unresolved");
    expect(
      (await readSubmissions({ ...namespace, ownerId: other.id }))[0]?.state,
    ).toBe("unresolved");
  });
});
