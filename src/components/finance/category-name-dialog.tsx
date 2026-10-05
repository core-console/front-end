import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";

import {
  getListFinanceCategoriesQueryKey,
  useUpdateFinanceCategory,
} from "@/api/generated/core-console";
import {
  CategoryResponse,
  type CategoryResponse as Category,
  type UpdateCategoryRequest,
} from "@/api/generated/schemas";
import { reconcileCategoryList } from "@/components/finance/category-list-cache";
import { getCategoryProblemFeedback } from "@/components/finance/category-problem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFinanceCreate } from "./use-finance-create";

type CategoryNameDialogProps = {
  category?: Category;
  categoryLabel?: string;
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
  ledgerId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (category: Category) => void;
  onUnavailable: (message: string) => void;
  open: boolean;
};

export function CategoryNameDialog({
  category,
  categoryLabel,
  finalFocus,
  ledgerId,
  onOpenChange,
  onSaved,
  onUnavailable,
  open,
}: CategoryNameDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [clientError, setClientError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const finish = async (response: { data: unknown }) => {
    const savedCategory = CategoryResponse.parse(response.data);
    reconcileCategoryList(queryClient, ledgerId, savedCategory);
    onSaved(savedCategory);
    onOpenChange(false);
    await queryClient.invalidateQueries({
      queryKey: getListFinanceCategoriesQueryKey(ledgerId),
    });
  };
  const create = useFinanceCreate(
    (result) => {
      if (!result.category) return;
      onSaved(result.category);
      onOpenChange(false);
    },
    ledgerId,
    open && !category,
  );
  const updateMutation = useUpdateFinanceCategory({
    mutation: {
      onError: (error) => {
        const problem = getCategoryProblemFeedback(
          error,
          "The Category could not be renamed. Try again.",
        );
        if (problem.kind !== "categoryNotFound") return;
        onUnavailable(problem.message);
        onOpenChange(false);
      },
      onSuccess: finish,
    },
  });
  const mutation = updateMutation;
  const pending = category ? mutation.isPending : create.pending;
  const problem =
    category && mutation.isError
      ? getCategoryProblemFeedback(
          mutation.error,
          `The Category could not be ${category ? "renamed" : "created"}. Try again.`,
        )
      : null;
  const serverError = category
    ? (problem?.message ?? "")
    : (create.error ?? "");
  const fieldError =
    clientError ||
    (problem?.field === "name" || (!category && create.rejected)
      ? serverError
      : "");
  const generalError =
    problem?.field || (!category && create.rejected) ? "" : serverError;
  const resetUpdateMutation = updateMutation.reset;

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setClientError("");
    resetUpdateMutation();
  }, [category, open, resetUpdateMutation]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setClientError("Enter a Category name.");
      nameRef.current?.focus();
      return;
    }
    if ([...normalizedName].length > 100) {
      setClientError("Category name must be 100 characters or fewer.");
      nameRef.current?.focus();
      return;
    }

    if (category) {
      updateMutation.mutate({
        categoryId: category.id,
        data: { name: normalizedName } satisfies UpdateCategoryRequest,
        ledgerId,
      });
    } else {
      void create.submit({
        operation: "createFinanceCategory",
        targetLedgerId: ledgerId,
        workflow: "category",
        body: { name: normalizedName },
      });
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && pending) return;
    onOpenChange(nextOpen);
  };

  const formId = category ? "rename-category" : "create-category";

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-busy={pending}
        finalFocus={finalFocus}
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            {category
              ? `Rename ${categoryLabel ?? category.name}`
              : "Create category"}
          </DialogTitle>
          <DialogDescription>
            {category
              ? "Change this neutral Category name without changing its lifecycle."
              : "Add an optional organizational Category to the current Ledger."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(fieldError)}>
              <FieldLabel htmlFor={`${formId}-name`}>Category name</FieldLabel>
              <Input
                aria-describedby={
                  fieldError ? `${formId}-name-error` : undefined
                }
                aria-errormessage={
                  fieldError ? `${formId}-name-error` : undefined
                }
                aria-invalid={Boolean(fieldError)}
                autoFocus
                id={`${formId}-name`}
                onChange={(event) => {
                  create.edited();
                  setName(event.target.value);
                  setClientError("");
                  if (mutation.isError) mutation.reset();
                }}
                ref={nameRef}
                value={name}
              />
              {fieldError ? (
                <FieldError id={`${formId}-name-error`}>
                  {fieldError}
                </FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          {generalError ? (
            <p className="text-sm text-destructive" role="alert">
              {generalError}
            </p>
          ) : null}
          {!category &&
          create.unresolved &&
          !create.integrityBlocked &&
          !pending ? (
            <Button
              type="button"
              variant="outline"
              onClick={create.startAnother}
            >
              Start a separate Category create
            </Button>
          ) : null}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                pending || (!category && (create.unresolved || !create.ready))
              }
              type="submit"
            >
              {pending
                ? category
                  ? "Renaming…"
                  : "Creating…"
                : category
                  ? "Rename category"
                  : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
