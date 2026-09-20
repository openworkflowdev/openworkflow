import type {
  CreateWorkflowRunParams,
  RerunWorkflowRunParams,
} from "./backend.js";
import type { JsonValue } from "./json.js";
import type { StepAttempt } from "./step-attempt.js";
import { isTerminalStatus, type WorkflowRun } from "./workflow-run.js";

interface PreparedWorkflowRerun {
  params: CreateWorkflowRunParams;
  stepIndex: number | null;
}

/**
 * Validate a rerun and reuse the source input, version, and configuration.
 * @param source - Source run, read within the copying transaction
 * @param request - Rerun request
 * @param steps - Source attempt metadata, read in the same transaction
 * @returns New run parameters and the exclusive step-index boundary
 */
export function prepareWorkflowRerun(
  source: Readonly<WorkflowRun> | null,
  request: Readonly<RerunWorkflowRunParams>,
  steps: readonly Pick<StepAttempt, "stepName" | "stepIndex" | "status">[],
): PreparedWorkflowRerun {
  if (!source) {
    throw new Error(`Workflow run ${request.workflowRunId} does not exist`);
  }
  if (!isTerminalStatus(source.status)) {
    throw new Error("Only finished workflow runs can be rerun");
  }
  const boundary = steps.find((step) => step.stepName === request.fromStep);
  if (request.fromStep !== null && !boundary) {
    throw new Error(
      `Step "${request.fromStep}" does not exist in workflow run ${source.id}`,
    );
  }
  const stepIndices = getRerunStepIndices(source.context);
  const completed = new Set<string>();
  if (boundary) {
    for (const step of steps) {
      if (step.stepIndex === null) {
        throw new Error(
          "Cannot rerun from a step without recorded step order; rerun the entire workflow instead",
        );
      }
      stepIndices.set(step.stepName, step.stepIndex);
      if (step.status === "completed" || step.status === "succeeded") {
        completed.add(step.stepName);
      }
    }
  }
  const stepIndex = boundary?.stepIndex ?? null;
  let context = request.context;
  if (stepIndex !== null) {
    for (const [name, index] of stepIndices) {
      if (index >= stepIndex || completed.has(name)) stepIndices.delete(name);
    }
    if (stepIndices.size > 0) {
      if (!isJsonObject(context)) context = {};
      context = {
        ...context,
        rerunStepIndices: Object.fromEntries(stepIndices),
      };
    }
  }
  return {
    stepIndex,
    params: {
      workflowName: source.workflowName,
      version: source.version,
      input: source.input,
      config: source.config,
      context,
      idempotencyKey: null,
      parentStepAttemptNamespaceId: null,
      parentStepAttemptId: null,
      availableAt: null,
      deadlineAt: null,
    },
  };
}

/**
 * Read step order retained independently of copied successful attempts.
 * @param context - Persisted workflow execution metadata
 * @returns Recorded indices, including steps omitted from a rerun's history
 */
export function getRerunStepIndices(context: JsonValue): Map<string, number> {
  if (!isJsonObject(context)) {
    return new Map();
  }
  const indices = context["rerunStepIndices"];
  if (!isJsonObject(indices)) {
    return new Map();
  }
  return new Map(
    Object.entries(indices).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] >= 0,
    ),
  );
}

function isJsonObject(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
