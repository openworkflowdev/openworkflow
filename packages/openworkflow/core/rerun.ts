import type {
  CreateWorkflowRunParams,
  RerunWorkflowRunParams,
} from "./backend.js";
import { isTerminalStatus, type WorkflowRun } from "./workflow-run.js";

/**
 * Validate a rerun and reuse the source input, version, and configuration.
 * @param source - Source run, read within the copying transaction
 * @param request - Rerun request
 * @param stepId - First attempt of the requested step, or null
 * @returns New run parameters
 */
export function prepareWorkflowRerun(
  source: Readonly<WorkflowRun> | null,
  request: Readonly<RerunWorkflowRunParams>,
  stepId: string | null,
): CreateWorkflowRunParams {
  if (!source) {
    throw new Error(`Workflow run ${request.workflowRunId} does not exist`);
  }
  if (!isTerminalStatus(source.status)) {
    throw new Error("Only finished workflow runs can be rerun");
  }
  if (request.fromStep !== null && stepId === null) {
    throw new Error(
      `Step "${request.fromStep}" does not exist in workflow run ${source.id}`,
    );
  }
  return {
    workflowName: source.workflowName,
    version: source.version,
    input: source.input,
    config: source.config,
    context: request.context,
    idempotencyKey: null,
    parentStepAttemptNamespaceId: null,
    parentStepAttemptId: null,
    availableAt: null,
    deadlineAt: null,
  };
}
