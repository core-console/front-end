import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  getListUsersQueryKey,
  useCreateUser,
} from "@/api/generated/core-console";
import { UserResponse } from "@/api/generated/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  UserIdentityFields,
  UserProfileFields,
} from "@/components/users/user-form-fields";
import { getUserProblemMessage } from "@/components/users/problem-details";

const nullableValue = (formData: FormData, name: string) => {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
};

const requiredValue = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

export function AddUserDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const createUserMutation = useCreateUser({
    mutation: {
      onSuccess: async (response) => {
        UserResponse.parse(response.data);
        await queryClient.invalidateQueries({
          queryKey: getListUsersQueryKey(),
        });
        setOpen(false);
      },
    },
  });
  const serverError = createUserMutation.isError
    ? getUserProblemMessage(
        createUserMutation.error,
        "User could not be added. Try again.",
      )
    : null;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setProfileError(null);
      setIdentityError(null);
      createUserMutation.reset();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const displayName = nullableValue(formData, "displayName");
    const username = nullableValue(formData, "username");
    const email = nullableValue(formData, "email");
    const identityIssuer = requiredValue(formData, "identityIssuer");
    const identitySubject = requiredValue(formData, "identitySubject");

    if (!displayName && !username && !email) {
      setProfileError("Enter a display name, username, or email.");
      return;
    }

    if (!identityIssuer || !identitySubject) {
      setIdentityError("Enter an identity issuer and subject.");
      return;
    }

    setProfileError(null);
    setIdentityError(null);
    createUserMutation.mutate({
      data: {
        displayName,
        email,
        identityIssuer,
        identitySubject,
        username,
      },
    });
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger render={<Button className="min-w-28" />}>
        <PlusIcon data-icon="inline-start" />
        Add user
      </DialogTrigger>
      <DialogContent className="gap-0 rounded-lg p-0 sm:max-w-[500px]">
        <DialogHeader className="px-6 py-[18px]">
          <DialogTitle className="text-xl leading-6 font-semibold">
            Add user
          </DialogTitle>
        </DialogHeader>
        <Separator />

        <form noValidate onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 px-6 py-4">
            <UserProfileFields error={profileError} idPrefix="add" />
            <UserIdentityFields error={identityError} idPrefix="add" />

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
              disabled={createUserMutation.isPending}
              size="lg"
              type="submit"
            >
              {createUserMutation.isPending ? "Adding…" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
