import type { Backend } from "../core/backend.js";
import type { WorkflowRun } from "../core/workflow-run.js";
import {
  captureTraceContext,
  getSpanKind,
  setAttributes,
  SPAN_NAMES,
  traceOperation,
  workflowRunAttributes,
} from "../telemetry.js";

/**
 * Rerun a finished workflow, optionally copying earlier successful steps.
 * @param backend - Backend containing the source run
 * @param workflowRunId - Source run ID
 * @param fromStep - Step to execute again; omit to rerun every step
 * @returns A new pending run
 */
export async function rerunWorkflowRun(
  backend: Readonly<Backend>,
  workflowRunId: string,
  fromStep?: string,
): Promise<WorkflowRun> {
  return traceOperation(
    SPAN_NAMES.WORKFLOW_RUN_CREATE,
    { kind: await getSpanKind("PRODUCER") },
    async (span) => {
      const run = await backend.rerunWorkflowRun({
        workflowRunId,
        fromStep: fromStep ?? null,
        context: captureTraceContext(),
      });
      setAttributes(span, workflowRunAttributes(run));
      return run;
    },
  );
}
