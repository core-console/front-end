import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import type { UserResponse } from "@/api/generated/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditUserDialog } from "@/components/users/edit-user-dialog";
import {
  UserLifecycleDialog,
  type UserLifecycleAction,
} from "@/components/users/user-lifecycle-dialog";
import { getUserHumanName } from "@/components/users/user-name";

interface UserActionsProps {
  currentUserId: string | undefined;
  deactivateDisabled: boolean;
  deactivateDisabledReason: string;
  user: UserResponse;
}

export function UserActions({
  currentUserId,
  deactivateDisabled,
  deactivateDisabledReason,
  user,
}: UserActionsProps) {
  const [editing, setEditing] = useState(false);
  const [lifecycleAction, setLifecycleAction] =
    useState<UserLifecycleAction | null>(null);
  const humanName = getUserHumanName(user);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${humanName}`}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setEditing(true)}>
              Edit
            </DropdownMenuItem>
            {user.status === "active" ? (
              <DropdownMenuItem
                aria-describedby={
                  deactivateDisabled
                    ? `deactivate-disabled-${user.id}`
                    : undefined
                }
                disabled={deactivateDisabled}
                onClick={() => setLifecycleAction("deactivate")}
                variant="destructive"
              >
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setLifecycleAction("reactivate")}
              >
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        currentUserId={currentUserId}
        onOpenChange={setEditing}
        open={editing}
        user={user}
      />
      {deactivateDisabled ? (
        <span className="sr-only" id={`deactivate-disabled-${user.id}`}>
          {deactivateDisabledReason}
        </span>
      ) : null}
      {lifecycleAction ? (
        <UserLifecycleDialog
          action={lifecycleAction}
          onOpenChange={(open) => {
            if (!open) setLifecycleAction(null);
          }}
          open
          user={user}
        />
      ) : null}
    </>
  );
}
