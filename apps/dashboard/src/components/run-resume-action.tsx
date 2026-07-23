import { RunActionDialog } from "@/components/run-action-dialog";
import { resumeWorkflowRunServerFn } from "@/lib/api";
import { isRunResumableStatus } from "@/lib/status";
import type { WorkflowRunStatus } from "openworkflow/internal";

interface RunResumeActionProps {
  runId: string;
  status: WorkflowRunStatus;
  onResumed?: (() => Promise<void>) | (() => void);
}

export function RunResumeAction({
  runId,
  status,
  onResumed,
}: RunResumeActionProps) {
  if (!isRunResumableStatus(status)) {
    return null;
  }

  return (
    <RunActionDialog
      triggerLabel="Resume Run"
      triggerVariant="default"
      title="Resume this failed run?"
      description="Completed steps stay cached and won't re-run. The failing step will be retried with a fresh retry budget. Previous failed attempts will be discarded."
      cancelLabel="Cancel"
      confirmLabel="Resume Run"
      pendingLabel="Resuming..."
      fallbackErrorMessage="Unable to resume workflow run"
      action={() =>
        resumeWorkflowRunServerFn({ data: { workflowRunId: runId } })
      }
      onDone={onResumed}
    />
  );
}
