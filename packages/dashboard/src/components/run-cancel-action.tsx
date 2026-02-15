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
import { cancelWorkflowRunServerFn } from "@/lib/api";
import { isRunCancelableStatus } from "@/lib/status";
import type { WorkflowRunStatus } from "openworkflow/internal";
import { useState } from "react";

interface RunCancelActionProps {
  runId: string;
  status: WorkflowRunStatus;
  onCanceled?: (() => Promise<void>) | (() => void);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to cancel workflow run";
}

export function RunCancelAction({
  runId,
  status,
  onCanceled,
}: RunCancelActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isRunCancelableStatus(status)) {
    return null;
  }

  async function cancelRun() {
    setIsCanceling(true);
    setError(null);

    try {
      await cancelWorkflowRunServerFn({
        data: {
          workflowRunId: runId,
        },
      });
      await onCanceled?.();
      setIsOpen(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsCanceling(false);
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
        variant="destructive"
        onClick={() => {
          setIsOpen(true);
        }}
        disabled={isCanceling}
      >
        Cancel Run
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
          <AlertDialogDescription>
            This will stop any future progress for this workflow run.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCanceling}>
            Keep Running
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              void cancelRun();
            }}
            disabled={isCanceling}
          >
            {isCanceling ? "Canceling..." : "Cancel Run"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
