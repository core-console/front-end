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
  useCreateFinanceCategory,
  useUpdateFinanceCategory,
} from "@/api/generated/core-console";
import {
  CategoryResponse,
  type CategoryResponse as Category,
  type CreateCategoryRequest,
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
  const createMutation = useCreateFinanceCategory({
    mutation: { onSuccess: finish },
  });
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
  const mutation = category ? updateMutation : createMutation;
  const problem = mutation.isError
    ? getCategoryProblemFeedback(
        mutation.error,
        `The Category could not be ${category ? "renamed" : "created"}. Try again.`,
      )
    : null;
  const serverError = problem?.message ?? "";
  const fieldError =
    clientError || (problem?.field === "name" ? serverError : "");
  const generalError = problem?.field ? "" : serverError;
  const resetCreateMutation = createMutation.reset;
  const resetUpdateMutation = updateMutation.reset;

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setClientError("");
    resetCreateMutation();
    resetUpdateMutation();
  }, [category, open, resetCreateMutation, resetUpdateMutation]);

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
      createMutation.mutate({
        data: { name: normalizedName } satisfies CreateCategoryRequest,
        ledgerId,
      });
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return;
    onOpenChange(nextOpen);
  };

  const formId = category ? "rename-category" : "create-category";

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-busy={mutation.isPending}
        finalFocus={finalFocus}
        showCloseButton={!mutation.isPending}
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
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending
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
