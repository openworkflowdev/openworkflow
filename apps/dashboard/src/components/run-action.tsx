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
import { cancelWorkflowRunServerFn, rerunWorkflowRunServerFn } from "@/lib/api";
import { isRunCancelableStatus, TERMINAL_RUN_STATUSES } from "@/lib/status";
import { useNavigate } from "@tanstack/react-router";
import type { WorkflowRunStatus } from "openworkflow/internal";
import { useState } from "react";

interface RunActionProps {
  action?: "cancel" | "rerun";
  fromStep?: string;
  runId: string;
  status: WorkflowRunStatus;
  onDone?: (() => Promise<void>) | (() => void);
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }

  return "Unable to update workflow run";
}

export function RunAction({
  action = "cancel",
  fromStep,
  runId,
  status,
  onDone,
}: RunActionProps) {
  const navigate = useNavigate();
  const rerun = action === "rerun";
  const rerunLabel = fromStep === undefined ? "Rerun" : "Rerun from step";
  const actionLabel = rerun ? rerunLabel : "Cancel Run";
  const rerunDescription =
    fromStep === undefined
      ? "Creates a new run with the original input and version. All steps will execute again."
      : `Creates a new run using successful results recorded before "${fromStep}". This step, later work, and earlier failed or unfinished steps will execute again if reached.`;
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    rerun ? !TERMINAL_RUN_STATUSES.has(status) : !isRunCancelableStatus(status)
  ) {
    return null;
  }

  async function performAction() {
    setIsPending(true);
    setError(null);

    try {
      if (rerun) {
        const run = await rerunWorkflowRunServerFn({
          data: { workflowRunId: runId, fromStep },
        });
        await navigate({ to: "/runs/$runId", params: { runId: run.id } });
      } else {
        await cancelWorkflowRunServerFn({ data: { workflowRunId: runId } });
      }
      await onDone?.();
      setIsOpen(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
        }
      }}
    >
      <Button
        type="button"
        variant={rerun ? "default" : "destructive"}
        onClick={() => {
          setIsOpen(true);
        }}
        disabled={isPending}
      >
        {actionLabel}
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {rerun ? `${rerunLabel}?` : "Cancel this run?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {rerun
              ? rerunDescription
              : "This will stop any future progress for this workflow run."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {rerun ? "Cancel" : "Keep Running"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={rerun ? "default" : "destructive"}
            onClick={(event) => {
              event.preventDefault();
              void performAction();
            }}
            disabled={isPending}
          >
            {isPending ? "Working..." : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
