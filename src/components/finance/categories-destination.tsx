import { EllipsisIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import {
  getListFinanceCategoriesQueryKey,
  useArchiveFinanceCategory,
  useListFinanceCategories,
  useUnarchiveFinanceCategory,
} from "@/api/generated/core-console";
import {
  CategoryResponse,
  type CategoryResponse as Category,
} from "@/api/generated/schemas";
import { CategoryNameDialog } from "@/components/finance/category-name-dialog";
import { categoryWorkflowLabel } from "@/components/finance/category-identity";
import {
  reconcileCategoryList,
  removeCategoryFromList,
} from "@/components/finance/category-list-cache";
import { getCategoryProblemFeedback } from "@/components/finance/category-problem";
import { buildFinanceSearch } from "@/components/finance/finance-route-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type CategoriesDestinationProps = {
  ledgerId: string;
  ledgerName: string;
};

type Lifecycle = Category["status"];
type CategoryFocusRequest = {
  categoryId: string;
  expectedStatus: Lifecycle | "missing";
};

function categoryMutationIdentity(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  if (!("categoryId" in value) || !("ledgerId" in value)) return null;
  if (
    typeof value.categoryId !== "string" ||
    typeof value.ledgerId !== "string"
  ) {
    return null;
  }
  return { categoryId: value.categoryId, ledgerId: value.ledgerId };
}

const lifecycleLabels: Record<Lifecycle, string> = {
  active: "Active Categories",
  archived: "Archived Categories",
};

function CategoryLifecycleGroup({
  categories,
  lifecycle,
  onArchive,
  onRename,
  onUnarchive,
  onViewTransactions,
  pendingCategoryIds,
}: {
  categories: Category[];
  lifecycle: Lifecycle;
  onArchive: (category: Category, invoker: HTMLButtonElement) => void;
  onRename: (category: Category, invoker: HTMLButtonElement) => void;
  onUnarchive: (category: Category, invoker: HTMLButtonElement) => void;
  onViewTransactions: (category: Category) => void;
  pendingCategoryIds: ReadonlySet<string>;
}) {
  const matchingCategories = categories.filter(
    (category) => category.status === lifecycle,
  );
  if (matchingCategories.length === 0) return null;
  const headingId = `${lifecycle}-categories-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 className="text-base font-semibold" id={headingId}>
        {lifecycleLabels[lifecycle]}
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {matchingCategories.map((category) => {
          const identityLabel = categoryWorkflowLabel(category, categories);
          const needsIdentityDisambiguation = identityLabel !== category.name;
          return (
            <article
              aria-busy={pendingCategoryIds.has(category.id)}
              aria-label={identityLabel}
              className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
              key={category.id}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 className="truncate text-sm font-medium">
                  {category.name}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {category.status === "active" ? "Active" : "Archived"}
                </span>
                {needsIdentityDisambiguation ? (
                  <span className="text-xs break-all text-muted-foreground">
                    Category ID {category.id}
                  </span>
                ) : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for ${identityLabel}`}
                  disabled={pendingCategoryIds.has(category.id)}
                  id={`category-actions-${category.id}`}
                  render={<Button size="icon-sm" variant="ghost" />}
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      aria-label={`Rename ${identityLabel}`}
                      onClick={() => {
                        const invoker = document.getElementById(
                          `category-actions-${category.id}`,
                        );
                        if (invoker instanceof HTMLButtonElement) {
                          onRename(category, invoker);
                        }
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      aria-label={`View transactions for ${identityLabel}`}
                      onClick={() => onViewTransactions(category)}
                    >
                      View transactions
                    </DropdownMenuItem>
                    {category.status === "active" ? (
                      <DropdownMenuItem
                        aria-label={`Archive ${identityLabel}`}
                        onClick={() => {
                          const invoker = document.getElementById(
                            `category-actions-${category.id}`,
                          );
                          if (invoker instanceof HTMLButtonElement) {
                            onArchive(category, invoker);
                          }
                        }}
                        variant="destructive"
                      >
                        Archive
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        aria-label={`Unarchive ${identityLabel}`}
                        onClick={() => {
                          const invoker = document.getElementById(
                            `category-actions-${category.id}`,
                          );
                          if (invoker instanceof HTMLButtonElement) {
                            onUnarchive(category, invoker);
                          }
                        }}
                      >
                        Unarchive
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CategoriesDestination({
  ledgerId,
  ledgerName,
}: CategoriesDestinationProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Category | null>(null);
  const [unarchiveConflictTarget, setUnarchiveConflictTarget] =
    useState<Category | null>(null);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [focusRequest, setFocusRequest] = useState<CategoryFocusRequest | null>(
    null,
  );
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const archiveCancelRef = useRef<HTMLButtonElement | null>(null);
  const editingCategoryUnavailable = useRef(false);
  const categoriesQuery = useListFinanceCategories(ledgerId, {
    query: {
      select: (response) => CategoryResponse.array().parse(response.data),
    },
  });
  const pendingCategoryMutationVariables = [
    ...useMutationState({
      filters: { mutationKey: ["updateFinanceCategory"], status: "pending" },
      select: (mutation) => mutation.state.variables,
    }),
    ...useMutationState({
      filters: { mutationKey: ["archiveFinanceCategory"], status: "pending" },
      select: (mutation) => mutation.state.variables,
    }),
    ...useMutationState({
      filters: {
        mutationKey: ["unarchiveFinanceCategory"],
        status: "pending",
      },
      select: (mutation) => mutation.state.variables,
    }),
  ];
  const pendingCategoryIds = new Set(
    pendingCategoryMutationVariables.flatMap((variables) => {
      const identity = categoryMutationIdentity(variables);
      return identity?.ledgerId === ledgerId ? [identity.categoryId] : [];
    }),
  );
  const archiveMutation = useArchiveFinanceCategory({
    mutation: {
      onError: (error, variables) => {
        const problem = getCategoryProblemFeedback(
          error,
          "The Category could not be archived. Try again.",
        );
        if (problem.kind !== "categoryNotFound") return;
        removeCategoryFromList(queryClient, ledgerId, variables.categoryId);
        setFocusRequest({
          categoryId: variables.categoryId,
          expectedStatus: "missing",
        });
        setActionError(problem.message);
        setArchiveTarget(null);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceCategoriesQueryKey(ledgerId),
        });
      },
      onSuccess: (response) => {
        const archived = CategoryResponse.parse(response.data);
        const categoryLabel = categoryWorkflowLabel(
          archived,
          categoriesQuery.data ?? [],
        );
        reconcileCategoryList(queryClient, ledgerId, archived);
        setFocusRequest({
          categoryId: archived.id,
          expectedStatus: archived.status,
        });
        setFeedback(`${categoryLabel} archived.`);
        setActionError("");
        setArchiveTarget(null);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceCategoriesQueryKey(ledgerId),
        });
      },
    },
  });
  const archiveError = archiveMutation.isError
    ? getCategoryProblemFeedback(
        archiveMutation.error,
        "The Category could not be archived. Try again.",
      ).message
    : null;
  const unarchiveMutation = useUnarchiveFinanceCategory({
    mutation: {
      onError: (error, variables) => {
        const problem = getCategoryProblemFeedback(
          error,
          "The Category could not be unarchived. Try again.",
        );
        setActionError(problem.message);
        const category = categoriesQuery.data?.find(
          (item) => item.id === variables.categoryId,
        );
        setUnarchiveConflictTarget(
          problem.kind === "nameConflict" && category ? category : null,
        );
        if (problem.kind !== "categoryNotFound") return;
        removeCategoryFromList(queryClient, ledgerId, variables.categoryId);
        setFocusRequest({
          categoryId: variables.categoryId,
          expectedStatus: "missing",
        });
        void queryClient.invalidateQueries({
          queryKey: getListFinanceCategoriesQueryKey(ledgerId),
        });
      },
      onSuccess: (response) => {
        const active = CategoryResponse.parse(response.data);
        const categoryLabel = categoryWorkflowLabel(
          active,
          categoriesQuery.data ?? [],
        );
        reconcileCategoryList(queryClient, ledgerId, active);
        setFocusRequest({
          categoryId: active.id,
          expectedStatus: active.status,
        });
        setFeedback(`${categoryLabel} unarchived.`);
        setActionError("");
        setUnarchiveConflictTarget(null);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceCategoriesQueryKey(ledgerId),
        });
      },
    },
  });

  useEffect(() => {
    if (!focusRequest || !categoriesQuery.data) return;

    const currentCategory = categoriesQuery.data.find(
      (category) => category.id === focusRequest.categoryId,
    );
    const cacheIsReady =
      focusRequest.expectedStatus === "missing"
        ? currentCategory === undefined
        : currentCategory?.status === focusRequest.expectedStatus;
    if (!cacheIsReady) return;

    const currentAction = document.getElementById(
      `category-actions-${focusRequest.categoryId}`,
    );
    const target =
      currentAction instanceof HTMLButtonElement
        ? currentAction
        : createButtonRef.current;
    if (target?.isConnected) target.focus();
    setFocusRequest(null);
  }, [categoriesQuery.data, focusRequest]);

  if (categoriesQuery.isPending) {
    return (
      <div
        aria-label="Loading Categories"
        className="@container/categories flex flex-col gap-7"
        role="status"
      >
        <span className="sr-only">Loading Categories…</span>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-36" />
          <div className="overflow-hidden rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-48" />
            <div className="mt-4 grid gap-3 @xl/categories:grid-cols-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (categoriesQuery.isError) {
    return (
      <div
        className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border bg-card p-6"
        role="alert"
      >
        <p className="text-sm">Categories could not be loaded. Try again.</p>
        <Button
          disabled={categoriesQuery.isFetching}
          onClick={() => void categoriesQuery.refetch()}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7" key={ledgerId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Categories in {ledgerName}
        </p>
        <Button
          onClick={() => {
            setActionError("");
            setFeedback("");
            setCreateOpen(true);
          }}
          ref={createButtonRef}
        >
          Create category
        </Button>
      </div>
      {categoriesQuery.data.length === 0 ? (
        <Empty className="border bg-card py-12">
          <EmptyHeader>
            <EmptyTitle>
              <h2>No Categories yet</h2>
            </EmptyTitle>
            <EmptyDescription>
              Categories are optional organizational labels. Income and Expense
              Transactions can always remain Uncategorized.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {categoriesQuery.data.every(
            (category) => category.status === "archived",
          ) ? (
            <Empty className="border bg-card py-8">
              <EmptyHeader>
                <EmptyTitle>
                  <h2>No active Categories</h2>
                </EmptyTitle>
                <EmptyDescription>
                  Archived Categories remain manageable, and new Transactions
                  can remain Uncategorized.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {(["active", "archived"] as const).map((lifecycle) => (
            <CategoryLifecycleGroup
              categories={categoriesQuery.data}
              key={lifecycle}
              lifecycle={lifecycle}
              onArchive={(category) => {
                setActionError("");
                setFeedback("");
                archiveMutation.reset();
                setArchiveTarget(category);
              }}
              onRename={(category) => {
                setActionError("");
                setFeedback("");
                editingCategoryUnavailable.current = false;
                setEditingCategory(category);
              }}
              onUnarchive={(category) => {
                setActionError("");
                setFeedback("");
                setUnarchiveConflictTarget(null);
                unarchiveMutation.mutate({
                  categoryId: category.id,
                  ledgerId,
                });
              }}
              onViewTransactions={(category) =>
                navigate(
                  `/finance/transactions${buildFinanceSearch(
                    ledgerId,
                    {},
                    {
                      categoryId: category.id,
                    },
                  )}`,
                )
              }
              pendingCategoryIds={pendingCategoryIds}
            />
          ))}
        </>
      )}
      <p className="sr-only" role="status">
        {feedback}
      </p>
      {actionError ? (
        <div
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
          role="alert"
        >
          <p>
            {unarchiveConflictTarget
              ? `${categoryWorkflowLabel(
                  unarchiveConflictTarget,
                  categoriesQuery.data,
                )} could not be unarchived. `
              : ""}
            {actionError}
            {unarchiveConflictTarget
              ? " To recover, rename it, then retry Unarchive."
              : ""}
          </p>
          {unarchiveConflictTarget ? (
            <Button
              aria-label={`Rename ${categoryWorkflowLabel(
                unarchiveConflictTarget,
                categoriesQuery.data,
              )}`}
              onClick={() => {
                editingCategoryUnavailable.current = false;
                setEditingCategory(unarchiveConflictTarget);
                setUnarchiveConflictTarget(null);
                setActionError("");
              }}
              size="sm"
              variant="outline"
            >
              Rename
            </Button>
          ) : null}
        </div>
      ) : null}
      <CategoryNameDialog
        finalFocus={() => createButtonRef.current}
        ledgerId={ledgerId}
        onOpenChange={(open) => {
          if (open) return;
          setCreateOpen(false);
        }}
        onSaved={(category) => setFeedback(`${category.name} created.`)}
        onUnavailable={setActionError}
        open={createOpen}
      />
      {editingCategory ? (
        <CategoryNameDialog
          category={editingCategory}
          categoryLabel={categoryWorkflowLabel(
            editingCategory,
            categoriesQuery.data,
          )}
          finalFocus={false}
          ledgerId={ledgerId}
          onOpenChange={(open) => {
            if (open) return;
            setFocusRequest({
              categoryId: editingCategory.id,
              expectedStatus: editingCategoryUnavailable.current
                ? "missing"
                : editingCategory.status,
            });
            editingCategoryUnavailable.current = false;
            setEditingCategory(null);
          }}
          onSaved={(category) => setFeedback(`${category.name} renamed.`)}
          onUnavailable={(message) => {
            editingCategoryUnavailable.current = true;
            removeCategoryFromList(queryClient, ledgerId, editingCategory.id);
            setActionError(message);
            void queryClient.invalidateQueries({
              queryKey: getListFinanceCategoriesQueryKey(ledgerId),
            });
          }}
          open
        />
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !archiveMutation.isPending) {
            if (archiveTarget) {
              setFocusRequest({
                categoryId: archiveTarget.id,
                expectedStatus: archiveTarget.status,
              });
            }
            setArchiveTarget(null);
          }
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent
          aria-busy={archiveMutation.isPending}
          finalFocus={false}
          initialFocus={archiveCancelRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget
                ? `Archive ${categoryWorkflowLabel(
                    archiveTarget,
                    categoriesQuery.data,
                  )}?`
                : "Archive Category?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archiving does not delete this Category. Its historical Category
              allocations remain readable, and it disappears from ordinary new
              Transaction suggestions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? (
            <p className="text-sm text-destructive" role="alert">
              {archiveError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={archiveMutation.isPending}
              ref={archiveCancelRef}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (!archiveTarget) return;
                archiveMutation.mutate({
                  categoryId: archiveTarget.id,
                  ledgerId,
                });
              }}
              variant="destructive"
            >
              {archiveMutation.isPending ? "Archiving…" : "Archive Category"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
