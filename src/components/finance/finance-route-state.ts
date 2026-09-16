import { z } from "zod";

const ledgerIdSchema = z.uuid();
const accountIdSchema = z.uuid();
const categoryIdSchema = z.uuid();
const transactionIdSchema = z.uuid();
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a calendar month.");
const dateSchema = z.iso.date();
const transactionKindSchema = z.enum([
  "income",
  "expense",
  "internalTransfer",
  "balanceAdjustment",
]);
const uncategorizedSchema = z.literal("true");

type AddressedValue =
  | { status: "absent" }
  | { rawValue: string; status: "invalid" }
  | { status: "valid"; value: string };

export type PortableFinanceState = {
  date?: string | undefined;
  from?: string | undefined;
  kind?: string | undefined;
  month?: string | undefined;
  to?: string | undefined;
  uncategorized?: string | undefined;
};

export type FinanceRouteState = {
  ledger: AddressedValue;
  portable: PortableFinanceState;
  resource: {
    accountId?: string | undefined;
    categoryId?: string | undefined;
  };
  transaction: AddressedValue;
};

function parseSearchValue(
  searchParams: URLSearchParams,
  key: string,
  schema: z.ZodType<string>,
): AddressedValue {
  const values = searchParams.getAll(key);
  if (values.length === 0) return { status: "absent" };
  if (values.length !== 1) return { rawValue: "", status: "invalid" };

  const result = schema.safeParse(values[0]);
  return result.success
    ? { status: "valid", value: result.data }
    : { rawValue: values[0]!, status: "invalid" };
}

function parsePathValue(
  value: string | undefined,
  schema: z.ZodType<string>,
): AddressedValue {
  if (value === undefined) return { status: "absent" };
  const result = schema.safeParse(value);
  return result.success
    ? { status: "valid", value: result.data }
    : { rawValue: value, status: "invalid" };
}

function validSearchValue(
  searchParams: URLSearchParams,
  key: string,
  schema: z.ZodType<string>,
) {
  const result = parseSearchValue(searchParams, key, schema);
  return result.status === "valid" ? result.value : undefined;
}

export function parseFinanceRouteState(
  searchParams: URLSearchParams,
  transactionId?: string,
): FinanceRouteState {
  return {
    ledger: parseSearchValue(searchParams, "ledger", ledgerIdSchema),
    portable: {
      date: validSearchValue(searchParams, "date", dateSchema),
      from: validSearchValue(searchParams, "from", dateSchema),
      kind: validSearchValue(searchParams, "kind", transactionKindSchema),
      month: validSearchValue(searchParams, "month", monthSchema),
      to: validSearchValue(searchParams, "to", dateSchema),
      uncategorized: validSearchValue(
        searchParams,
        "uncategorized",
        uncategorizedSchema,
      ),
    },
    resource: {
      accountId: validSearchValue(searchParams, "account_id", accountIdSchema),
      categoryId: validSearchValue(
        searchParams,
        "category_id",
        categoryIdSchema,
      ),
    },
    transaction: parsePathValue(transactionId, transactionIdSchema),
  };
}

export function parseRememberedLedgerId(value: string | null) {
  const result = ledgerIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function addressedLedgerValue(ledger: AddressedValue) {
  if (ledger.status === "valid") return ledger.value;
  if (ledger.status === "invalid") return ledger.rawValue;
  return undefined;
}

export function buildFinanceSearch(
  ledgerValue: string | undefined,
  portable: PortableFinanceState = {},
  resource: FinanceRouteState["resource"] = {},
) {
  const searchParams = new URLSearchParams();
  if (ledgerValue !== undefined) searchParams.set("ledger", ledgerValue);
  for (const key of [
    "month",
    "date",
    "from",
    "to",
    "kind",
    "uncategorized",
  ] as const) {
    const value = portable[key];
    if (value !== undefined) searchParams.set(key, value);
  }
  if (resource.accountId !== undefined) {
    searchParams.set("account_id", accountIdSchema.parse(resource.accountId));
  }
  if (resource.categoryId !== undefined) {
    searchParams.set(
      "category_id",
      categoryIdSchema.parse(resource.categoryId),
    );
  }
  return searchParams.size > 0 ? `?${searchParams.toString()}` : "";
}
