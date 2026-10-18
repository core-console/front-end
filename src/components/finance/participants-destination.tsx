import { useListFinanceParticipants } from "@/api/generated/core-console";
import { useIsMutating } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { ParticipantNameDialog } from "@/components/finance/participant-name-dialog";
import { ParticipantDetailDialog } from "@/components/finance/participant-detail-dialog";
import { ParticipantResponse } from "@/api/generated/schemas";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export function ParticipantsDestination({
  ledgerId,
  ledgerName,
}: {
  ledgerId: string;
  ledgerName: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const pending =
    useIsMutating({
      predicate: (mutation) => {
        const variables: unknown = mutation.state.variables;
        return (
          [
            "createFinanceParticipant",
            "renameFinanceParticipant",
            "archiveFinanceParticipant",
          ].includes(String(mutation.options.mutationKey?.[0])) &&
          typeof variables === "object" &&
          variables !== null &&
          "ledgerId" in variables &&
          variables.ledgerId === ledgerId
        );
      },
    }) > 0;
  const query = useListFinanceParticipants(ledgerId, {
    query: {
      select: (response) =>
        ParticipantResponse.array()
          .refine((items) => items.every((item) => item.ledgerId === ledgerId))
          .parse(response.data),
    },
  });
  return (
    <div className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]">
      <p className="text-sm text-muted-foreground">
        Private Participants in {ledgerName}. Recording a person does not grant
        Ledger access.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          ref={createButton}
          disabled={pending}
          onClick={() => {
            setFeedback("");
            setCreateOpen(true);
          }}
        >
          Create participant
        </Button>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh Participants
        </Button>
      </div>
      {pending ? <p role="status">Saving Participant changes…</p> : null}
      <p role="status" aria-atomic="true">
        {feedback}
      </p>
      {query.isPending ? <p role="status">Loading Participants…</p> : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Participants could not be loaded.</AlertTitle>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry Participants
          </Button>
        </Alert>
      ) : null}
      {query.data?.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyTitle>No Participants yet</EmptyTitle>
            <EmptyDescription>
              Create a private Participant to keep a stable identity in this
              Ledger.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {query.data?.length ? (
        <Table aria-label="Participants">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((item) => {
              const duplicate =
                query.data.filter(
                  (other) =>
                    other.name.trim().toLowerCase() ===
                    item.name.trim().toLowerCase(),
                ).length > 1;
              const label = duplicate
                ? `${item.name}, Participant ID ${item.id}`
                : item.name;
              return (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal">
                    <span className="[overflow-wrap:anywhere]">
                      {item.name}
                    </span>
                    {duplicate ? (
                      <p className="text-xs break-all text-muted-foreground">
                        Participant ID {item.id}
                      </p>
                    ) : null}
                    <Link
                      className="block text-sm underline underline-offset-4"
                      aria-label={`View receivables for ${label}`}
                      to={`/finance/advances?ledger=${ledgerId}&participant_id=${item.id}`}
                    >
                      Receivables
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "active" ? "secondary" : "outline"
                      }
                    >
                      {item.status === "active" ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      id={`participant-inspect-${item.id}`}
                      disabled={pending}
                      aria-label={`Inspect ${label}`}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFeedback("");
                        setParticipantId(item.id);
                      }}
                    >
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {createOpen ? (
        <ParticipantNameDialog
          ledgerId={ledgerId}
          finalFocus={createButton}
          onClose={() => setCreateOpen(false)}
          onSaved={(item) => setFeedback(`${item.name} created.`)}
        />
      ) : null}
      {participantId ? (
        <ParticipantDetailDialog
          ledgerId={ledgerId}
          participantId={participantId}
          finalFocus={() =>
            document.getElementById(`participant-inspect-${participantId}`) ??
            createButton.current
          }
          onClose={() => setParticipantId(null)}
          onSaved={(item, action) => setFeedback(`${item.name} ${action}.`)}
        />
      ) : null}
    </div>
  );
}
