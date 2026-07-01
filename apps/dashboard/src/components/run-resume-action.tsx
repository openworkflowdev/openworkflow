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
import { resumeWorkflowRunServerFn } from "@/lib/api";
import { isRunResumableStatus } from "@/lib/status";
import type { WorkflowRunStatus } from "openworkflow/internal";
import { useState } from "react";

interface RunResumeActionProps {
  runId: string;
  status: WorkflowRunStatus;
  onResumed?: (() => Promise<void>) | (() => void);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to resume workflow run";
}

export function RunResumeAction({
  runId,
  status,
  onResumed,
}: RunResumeActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isRunResumableStatus(status)) {
    return null;
  }

  async function resumeRun() {
    setIsResuming(true);
    setError(null);

    try {
      await resumeWorkflowRunServerFn({
        data: {
          workflowRunId: runId,
        },
      });
      await onResumed?.();
      setIsOpen(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsResuming(false);
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
        variant="default"
        onClick={() => {
          setIsOpen(true);
        }}
        disabled={isResuming}
      >
        Resume Run
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resume this failed run?</AlertDialogTitle>
          <AlertDialogDescription>
            Completed steps stay cached and won't re-run. The failing step will
            be retried with a fresh retry budget. Previous failed attempts will
            be discarded.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isResuming}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void resumeRun();
            }}
            disabled={isResuming}
          >
            {isResuming ? "Resuming..." : "Resume Run"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
