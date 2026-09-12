import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import { useListFinanceLedgers } from "@/api/generated/core-console";
import { LedgerResponse } from "@/api/generated/schemas";
import { LedgerOnboarding } from "@/components/finance/ledger-onboarding";
import { LedgerNameDialog } from "@/components/finance/ledger-name-dialog";
import {
  addressedLedgerValue,
  buildFinanceSearch,
  parseFinanceRouteState,
  parseRememberedLedgerId,
} from "@/components/finance/finance-route-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const destinations = [
  { label: "Overview", slug: "overview" },
  { label: "Transactions", slug: "transactions" },
  { label: "Accounts", slug: "accounts" },
  { label: "Categories", slug: "categories" },
] as const;

const rememberedLedgerKey = "core-console.finance.last-ledger-id";

type Destination = (typeof destinations)[number];
type LedgerDialogState =
  { mode: "create" } | { ledger: LedgerResponse; mode: "rename" } | null;

const findDestination = (section: string | undefined) =>
  destinations.find((destination) => destination.slug === section);

function destinationHref(
  destination: Destination,
  ledgerId?: string,
  portable?: Parameters<typeof buildFinanceSearch>[1],
) {
  return `/finance/${destination.slug}${buildFinanceSearch(ledgerId, portable)}`;
}

function currentOverviewHref(ledgerId: string) {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `/finance/overview${buildFinanceSearch(ledgerId, {
    date,
    month: date.slice(0, 7),
  })}`;
}

function LedgerMenu({
  ledgers,
  onCreate,
  onRename,
  onSwitch,
  selectedLedger,
}: {
  ledgers: LedgerResponse[];
  onCreate: () => void;
  onRename: () => void;
  onSwitch: (ledger: LedgerResponse) => void;
  selectedLedger: LedgerResponse | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button className="mb-3" size="sm" variant="outline" />}
      >
        {selectedLedger?.name ?? "Choose a Ledger"}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          {ledgers.map((ledger) => (
            <DropdownMenuItem key={ledger.id} onClick={() => onSwitch(ledger)}>
              {ledger.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCreate}>Create Ledger</DropdownMenuItem>
          {selectedLedger ? (
            <DropdownMenuItem
              aria-label={`Rename ${selectedLedger.name} Ledger`}
              onClick={onRename}
            >
              Rename Ledger
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Component() {
  const { section, transactionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<LedgerDialogState>(null);
  const destination = transactionId
    ? destinations[1]
    : findDestination(section);
  const routeState = parseFinanceRouteState(searchParams, transactionId);
  const ledgerId =
    routeState.ledger.status === "valid" ? routeState.ledger.value : undefined;
  const ledgerAddress = addressedLedgerValue(routeState.ledger);
  const ledgersQuery = useListFinanceLedgers({
    query: {
      select: (response) => LedgerResponse.array().parse(response.data),
    },
  });
  const rememberedLedgerId = parseRememberedLedgerId(
    localStorage.getItem(rememberedLedgerKey),
  );
  const selectedLedger =
    routeState.ledger.status !== "absent"
      ? ledgersQuery.data?.find((ledger) => ledger.id === ledgerId)
      : (ledgersQuery.data?.find(
          (ledger) =>
            rememberedLedgerId !== undefined &&
            ledger.id === rememberedLedgerId,
        ) ?? ledgersQuery.data?.[0]);

  const switchLedger = (ledger: LedgerResponse) => {
    if (selectedLedger?.id === ledger.id) return;

    const nextDestination =
      routeState.transaction.status === "valid"
        ? destinations[1]!
        : destination!;
    navigate(
      `/finance/${nextDestination.slug}${buildFinanceSearch(
        ledger.id,
        routeState.portable,
      )}`,
    );
  };

  useEffect(() => {
    if (selectedLedger) {
      localStorage.setItem(rememberedLedgerKey, selectedLedger.id);
    }
  }, [selectedLedger]);

  useEffect(() => {
    if (
      dialog?.mode === "rename" &&
      (ledgerId !== dialog.ledger.id || selectedLedger?.id !== dialog.ledger.id)
    ) {
      setDialog(null);
    }
  }, [dialog, ledgerId, selectedLedger]);

  if (!destination) {
    return (
      <Navigate replace to={destinationHref(destinations[0], ledgerAddress)} />
    );
  }

  if (routeState.transaction.status === "invalid") {
    return (
      <Navigate
        replace
        to={`/finance/transactions${buildFinanceSearch(
          ledgerAddress,
          routeState.portable,
        )}`}
      />
    );
  }

  if (
    ledgersQuery.isSuccess &&
    routeState.ledger.status === "absent" &&
    selectedLedger
  ) {
    return (
      <Navigate
        replace
        to={destinationHref(
          destination,
          selectedLedger.id,
          routeState.portable,
        )}
      />
    );
  }

  return (
    <section
      aria-labelledby="finance-title"
      className="flex flex-col gap-6 pb-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border">
        <div className="flex flex-col gap-3">
          <h1
            className="text-2xl leading-8 font-semibold tracking-tight"
            id="finance-title"
          >
            {destination.label}
          </h1>
          <nav aria-label="Finance navigation" className="flex gap-6">
            {destinations.map((item) => {
              const active = item.slug === destination.slug;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "border-b-2 px-0.5 pb-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  key={item.slug}
                  to={destinationHref(
                    item,
                    selectedLedger?.id ?? ledgerAddress,
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {ledgersQuery.isSuccess && ledgersQuery.data.length > 0 ? (
          <LedgerMenu
            ledgers={ledgersQuery.data}
            onCreate={() => setDialog({ mode: "create" })}
            onRename={() => {
              if (selectedLedger) {
                setDialog({ ledger: selectedLedger, mode: "rename" });
              }
            }}
            onSwitch={switchLedger}
            selectedLedger={selectedLedger}
          />
        ) : null}
      </div>

      {ledgersQuery.isPending ? (
        <p
          aria-label="Loading Finance Ledgers"
          className="text-sm text-muted-foreground"
          role="status"
        >
          Loading Ledgers…
        </p>
      ) : null}
      {ledgersQuery.isError ? (
        <div
          className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border bg-card p-6"
          role="alert"
        >
          <p className="text-sm">
            Finance could not load your Ledgers. Try again.
          </p>
          <Button
            disabled={ledgersQuery.isFetching}
            onClick={() => void ledgersQuery.refetch()}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      {ledgersQuery.isSuccess &&
      routeState.ledger.status !== "absent" &&
      !selectedLedger ? (
        <div className="flex max-w-2xl flex-col gap-2 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Ledger unavailable</h2>
          <p className="text-sm text-muted-foreground">
            The requested Ledger is not available. Select another Ledger to
            continue.
          </p>
        </div>
      ) : null}
      {ledgersQuery.isSuccess && ledgersQuery.data.length === 0 ? (
        <LedgerOnboarding
          onCreated={(ledger) =>
            navigate(currentOverviewHref(ledger.id), { flushSync: true })
          }
        />
      ) : null}
      {selectedLedger ? (
        <div
          className="rounded-lg border border-border bg-card p-6"
          key={selectedLedger.id}
        >
          <p className="text-sm text-muted-foreground">
            {destination.label} for {selectedLedger.name}
          </p>
        </div>
      ) : null}
      <LedgerNameDialog
        mode="create"
        onComplete={switchLedger}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        open={dialog?.mode === "create"}
      />
      {dialog?.mode === "rename" ? (
        <LedgerNameDialog
          ledger={dialog.ledger}
          mode="rename"
          onComplete={() => undefined}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          open
        />
      ) : null}
    </section>
  );
}
