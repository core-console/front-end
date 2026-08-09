import { useGetCurrentUser, useListUsers } from "@/api/generated/core-console";
import { MeResponse, UserResponse } from "@/api/generated/schemas";
import { AddUserDialog } from "@/components/users/add-user-dialog";
import { UserActions } from "@/components/users/user-actions";
import { getUserProblemMessage } from "@/components/users/problem-details";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function Status({ status }: { status: UserResponse["status"] }) {
  const label = status === "active" ? "Active" : "Inactive";

  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span
        aria-hidden="true"
        className={
          status === "active"
            ? "size-2 rounded-full bg-status-active"
            : "size-2 rounded-full bg-status-inactive"
        }
      />
      {label}
    </span>
  );
}

function EmptyTableRow({ children }: { children: string }) {
  return (
    <TableRow>
      <TableCell
        className="h-16 px-4 text-center text-muted-foreground"
        colSpan={5}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

export function UsersPage() {
  const currentUserQuery = useGetCurrentUser({
    query: {
      select: (response) => MeResponse.parse(response.data),
    },
  });
  const usersQuery = useListUsers({
    query: {
      select: (response) => UserResponse.array().parse(response.data),
    },
  });

  return (
    <section
      aria-labelledby="users-title"
      className="-mt-4 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h1
          className="text-2xl leading-8 font-semibold text-foreground"
          id="users-title"
        >
          Users
        </h1>
        <AddUserDialog />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table className="table-fixed">
          <TableHeader className="bg-secondary">
            <TableRow className="hover:bg-secondary">
              <TableHead className="h-9 w-[21%] px-4">Display name</TableHead>
              <TableHead className="h-9 w-[18%] px-4">Username</TableHead>
              <TableHead className="h-9 w-[36%] px-4">Email</TableHead>
              <TableHead className="h-9 w-[17%] px-4">Status</TableHead>
              <TableHead className="h-9 w-[8%] px-4 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isPending ? (
              <EmptyTableRow>Loading users…</EmptyTableRow>
            ) : usersQuery.isError ? (
              <EmptyTableRow>
                {getUserProblemMessage(
                  usersQuery.error,
                  "Users could not be loaded.",
                )}
              </EmptyTableRow>
            ) : usersQuery.data.length === 0 ? (
              <EmptyTableRow>No users.</EmptyTableRow>
            ) : (
              usersQuery.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="h-11 truncate px-4 font-medium">
                    {user.displayName?.trim() || "—"}
                  </TableCell>
                  <TableCell className="h-11 truncate px-4 text-muted-foreground">
                    {user.username?.trim() || "—"}
                  </TableCell>
                  <TableCell className="h-11 truncate px-4 text-muted-foreground">
                    {user.email?.trim() || "—"}
                  </TableCell>
                  <TableCell className="h-11 px-4">
                    <Status status={user.status} />
                  </TableCell>
                  <TableCell className="h-11 px-4 text-right">
                    <UserActions
                      currentUserId={currentUserQuery.data?.id}
                      deactivateDisabled={
                        !currentUserQuery.data ||
                        user.id === currentUserQuery.data.id
                      }
                      deactivateDisabledReason={
                        currentUserQuery.data
                          ? "You cannot deactivate your own account."
                          : "The current account could not be verified."
                      }
                      user={user}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function Component() {
  return <UsersPage />;
}
