import { useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import {
  getListUsersQueryKey,
  useDeactivateUser,
  useReactivateUser,
} from "@/api/generated/core-console";
import { UserResponse } from "@/api/generated/schemas";
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
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { getUserHumanName } from "@/components/users/user-name";
import { getUserProblemMessage } from "@/components/users/problem-details";

export type UserLifecycleAction = "deactivate" | "reactivate";

interface UserLifecycleDialogProps {
  action: UserLifecycleAction;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: UserResponse;
}

export function UserLifecycleDialog({
  action,
  onOpenChange,
  open,
  user,
}: UserLifecycleDialogProps) {
  const queryClient = useQueryClient();
  const title = action === "deactivate" ? "Deactivate user" : "Reactivate user";
  const actionLabel = action === "deactivate" ? "Deactivate" : "Reactivate";
  const humanName = getUserHumanName(user);
  const completeMutation = async (response: { data: unknown }) => {
    UserResponse.parse(response.data);
    await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    onOpenChange(false);
  };
  const deactivateMutation = useDeactivateUser({
    mutation: { onSuccess: completeMutation },
  });
  const reactivateMutation = useReactivateUser({
    mutation: { onSuccess: completeMutation },
  });
  const mutation =
    action === "deactivate" ? deactivateMutation : reactivateMutation;
  const serverError = mutation.isError
    ? getUserProblemMessage(
        mutation.error,
        "User status could not be changed. Try again.",
      )
    : null;

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      deactivateMutation.reset();
      reactivateMutation.reset();
    }
  };

  const handleConfirm = () => {
    if (action === "deactivate") {
      deactivateMutation.mutate({ userId: user.id });
    } else {
      reactivateMutation.mutate({ userId: user.id });
    }
  };

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={open}>
      <AlertDialogContent className="gap-0 rounded-lg p-0 sm:max-w-[440px]">
        <AlertDialogCancel
          aria-label="Close"
          className="absolute top-3.5 right-5"
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>
        <AlertDialogHeader className="block px-6 py-[18px] text-left">
          <AlertDialogTitle className="text-xl leading-6 font-semibold">
            {title}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <Separator />

        <div className="flex flex-col gap-2 px-6 py-4">
          <p className="text-lg leading-6 font-semibold">
            {actionLabel} {humanName}?
          </p>
          <AlertDialogDescription className="text-left">
            {action === "deactivate"
              ? "This user will no longer be able to access Core Console until they are reactivated."
              : "This user will be able to access Core Console again."}
          </AlertDialogDescription>
          {serverError ? <FieldError>{serverError}</FieldError> : null}
        </div>

        <Separator />
        <AlertDialogFooter className="m-0 rounded-none border-0 bg-card px-6 py-3.5">
          <AlertDialogCancel autoFocus size="lg" variant="ghost">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={handleConfirm}
            size="lg"
            variant={action === "deactivate" ? "destructive" : "default"}
            className={
              action === "deactivate"
                ? "min-w-[102px] bg-destructive text-white hover:bg-destructive/90"
                : undefined
            }
          >
            {mutation.isPending ? `${actionLabel}…` : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
