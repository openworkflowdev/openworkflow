import { RunActionDialog } from "@/components/run-action-dialog";
import { cancelWorkflowRunServerFn } from "@/lib/api";
import { isRunCancelableStatus } from "@/lib/status";
import type { WorkflowRunStatus } from "openworkflow/internal";

interface RunCancelActionProps {
  runId: string;
  status: WorkflowRunStatus;
  onCanceled?: (() => Promise<void>) | (() => void);
}

export function RunCancelAction({
  runId,
  status,
  onCanceled,
}: RunCancelActionProps) {
  if (!isRunCancelableStatus(status)) {
    return null;
  }

  return (
    <RunActionDialog
      triggerLabel="Cancel Run"
      triggerVariant="destructive"
      title="Cancel this run?"
      description="This will stop any future progress for this workflow run."
      cancelLabel="Keep Running"
      confirmLabel="Cancel Run"
      pendingLabel="Canceling..."
      confirmVariant="destructive"
      fallbackErrorMessage="Unable to cancel workflow run"
      action={() =>
        cancelWorkflowRunServerFn({ data: { workflowRunId: runId } })
      }
      onDone={onCanceled}
    />
  );
}
