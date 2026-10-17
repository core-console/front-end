import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ComponentProps } from "react";

import {
  getListFinanceParticipantsQueryKey,
  useGetFinanceParticipant,
  useArchiveFinanceParticipant,
} from "@/api/generated/core-console";
import {
  parseParticipant,
  participantError,
  reconcileParticipant,
} from "@/components/finance/participant-data";
import { ParticipantNameDialog } from "@/components/finance/participant-name-dialog";
import type { ParticipantResponse } from "@/api/generated/schemas";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ParticipantDetailDialog({
  ledgerId,
  participantId,
  finalFocus,
  onClose,
  onSaved,
}: {
  ledgerId: string;
  participantId: string;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  onClose: () => void;
  onSaved: (item: ParticipantResponse, action: "renamed" | "archived") => void;
}) {
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const renameButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const query = useGetFinanceParticipant(ledgerId, participantId, {
    query: {
      select: (response) =>
        parseParticipant(response.data, ledgerId, participantId),
    },
  });
  const archive = useArchiveFinanceParticipant({
    mutation: {
      retry: false,
      onSuccess: async (response) => {
        const item = parseParticipant(response.data, ledgerId, participantId);
        await reconcileParticipant(queryClient, item, response);
        onSaved(item, "archived");
        setFeedback(`${item.name} archived.`);
        setArchiveOpen(false);
      },
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !archive.isPending) onClose();
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        showCloseButton={!archive.isPending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Participant details</DialogTitle>
          <DialogDescription>
            Private identity in the selected Ledger. Renaming and archiving
            preserve attribution.
          </DialogDescription>
        </DialogHeader>
        <p
          role="status"
          aria-atomic="true"
          className="[overflow-wrap:anywhere]"
        >
          {feedback}
        </p>
        {query.isPending ? <p role="status">Loading Participant…</p> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Participant details could not be loaded.</AlertTitle>
            <p>{participantError(query.error)}</p>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry details
            </Button>
          </Alert>
        ) : null}
        {query.data && !query.isError ? (
          <>
            <dl className="grid gap-2">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="[overflow-wrap:anywhere]">{query.data.name}</dd>
              <dt className="text-muted-foreground">Participant ID</dt>
              <dd className="break-all">{query.data.id}</dd>
              <dt className="text-muted-foreground">Ledger ID</dt>
              <dd className="break-all">{query.data.ledgerId}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant="secondary">
                  {query.data.status === "active" ? "Active" : "Archived"}
                </Badge>
              </dd>
            </dl>
            {query.data.status === "archived" ? (
              <p className="text-sm text-muted-foreground">
                This archived identity remains available for inspection and
                attribution. Archiving does not change balances.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                ref={renameButton}
                variant="outline"
                onClick={() => setRenameOpen(true)}
              >
                Rename participant
              </Button>
              {query.data.status === "active" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    archive.reset();
                    setArchiveOpen(true);
                  }}
                >
                  Archive participant
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={archive.isPending}
          >
            Close details
          </Button>
        </DialogFooter>
        {renameOpen && query.data ? (
          <ParticipantNameDialog
            ledgerId={ledgerId}
            participant={query.data}
            finalFocus={renameButton}
            onClose={() => setRenameOpen(false)}
            onSaved={(item) => {
              setFeedback(`${item.name} renamed.`);
              onSaved(item, "renamed");
            }}
          />
        ) : null}
        <AlertDialog
          open={archiveOpen}
          onOpenChange={(open) => {
            if (!archive.isPending) setArchiveOpen(open);
          }}
        >
          <AlertDialogContent
            aria-busy={archive.isPending}
            initialFocus={cancelButton}
            finalFocus={renameButton}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Archive Participant?</AlertDialogTitle>
              <AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
                Archive {query.data?.name}. This preserves the Participant ID,
                historical attribution, debt and credit, and does not change
                balances. There is no unarchive action.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {archive.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{participantError(archive.error)}</AlertTitle>
                <Button
                  variant="outline"
                  disabled={query.isFetching}
                  onClick={() => {
                    setArchiveOpen(false);
                    void query.refetch();
                    void queryClient.invalidateQueries({
                      queryKey: getListFinanceParticipantsQueryKey(ledgerId),
                    });
                  }}
                >
                  Refresh Participant
                </Button>
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <Button
                ref={cancelButton}
                variant="outline"
                disabled={archive.isPending}
                onClick={() => setArchiveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={archive.isPending}
                onClick={() => archive.mutate({ ledgerId, participantId })}
              >
                {archive.isPending ? "Archiving…" : "Archive participant"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
