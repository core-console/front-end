import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import {
  getGetCurrentUserQueryKey,
  getListUsersQueryKey,
  useUpdateUser,
} from "@/api/generated/core-console";
import { UserResponse, type UpdateUserRequest } from "@/api/generated/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  UserIdentityFields,
  UserProfileFields,
} from "@/components/users/user-form-fields";
import { getUserProblemMessage } from "@/components/users/problem-details";

interface EditUserDialogProps {
  currentUserId: string | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: UserResponse;
}

const normalizedValue = (value: FormDataEntryValue | string | null) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

export function EditUserDialog({
  currentUserId,
  onOpenChange,
  open,
  user,
}: EditUserDialogProps) {
  const queryClient = useQueryClient();
  const [profileError, setProfileError] = useState<string | null>(null);
  const updateUserMutation = useUpdateUser({
    mutation: {
      onSuccess: async (response) => {
        UserResponse.parse(response.data);
        const invalidations = [
          queryClient.invalidateQueries({
            queryKey: getListUsersQueryKey(),
          }),
        ];
        if (user.id === currentUserId) {
          invalidations.push(
            queryClient.invalidateQueries({
              queryKey: getGetCurrentUserQueryKey(),
            }),
          );
        }
        await Promise.all(invalidations);
        onOpenChange(false);
      },
    },
  });
  const serverError = updateUserMutation.isError
    ? getUserProblemMessage(
        updateUserMutation.error,
        "User could not be updated. Try again.",
      )
    : null;

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setProfileError(null);
      updateUserMutation.reset();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const displayName = normalizedValue(formData.get("displayName"));
    const username = normalizedValue(formData.get("username"));
    const email = normalizedValue(formData.get("email"));

    if (!displayName && !username && !email) {
      setProfileError("Enter a display name, username, or email.");
      return;
    }

    const update: UpdateUserRequest = {};
    if (displayName !== normalizedValue(user.displayName)) {
      update.displayName = displayName;
    }
    if (username !== normalizedValue(user.username)) {
      update.username = username;
    }
    if (email !== normalizedValue(user.email)) {
      update.email = email;
    }

    setProfileError(null);
    if (Object.keys(update).length === 0) {
      handleOpenChange(false);
      return;
    }

    updateUserMutation.mutate({ data: update, userId: user.id });
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-0 rounded-lg p-0 sm:max-w-[500px]">
        <DialogHeader className="px-6 py-[18px]">
          <DialogTitle className="text-xl leading-6 font-semibold">
            Edit user
          </DialogTitle>
        </DialogHeader>
        <Separator />

        <form noValidate onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 px-6 py-4">
            <UserProfileFields
              defaultValues={user}
              error={profileError}
              idPrefix={`edit-${user.id}`}
            />
            <UserIdentityFields
              idPrefix={`edit-${user.id}`}
              identityIssuer={user.identityIssuer}
              identitySubject={user.identitySubject}
              readOnly
            />
            {serverError ? <FieldError>{serverError}</FieldError> : null}
          </div>

          <Separator />
          <DialogFooter className="m-0 rounded-none border-0 bg-card px-6 py-3.5">
            <DialogClose
              render={<Button size="lg" type="button" variant="ghost" />}
            >
              Cancel
            </DialogClose>
            <Button
              disabled={updateUserMutation.isPending}
              size="lg"
              type="submit"
            >
              {updateUserMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
