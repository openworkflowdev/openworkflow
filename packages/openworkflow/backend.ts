// Backend contract and the helpers the built-in backends share, for authors of
// custom backends. Experimental: may change in a minor release before 1.0.

// contract
export * from "./core/backend.js";
export type { SerializedError } from "./core/error.js";
export type { JsonValue } from "./core/json.js";
export type {
  WorkflowSchedule,
  WorkflowScheduleDefinition,
} from "./core/schedule.js";
export type {
  StepAttempt,
  StepAttemptContext,
  StepAttemptStatus,
  StepKind,
} from "./core/step-attempt.js";
export type { WorkflowRun, WorkflowRunStatus } from "./core/workflow-run.js";

// helpers
export type { Cursor } from "./core/cursor.js";
export {
  buildPaginatedResponse,
  DEFAULT_PAGINATION_PAGE_SIZE,
  decodeListCursor,
} from "./core/cursor.js";
export { requireRow, wrapError } from "./core/error.js";
export { prepareWorkflowRerun } from "./core/rerun.js";
export { nextScheduleOccurrence } from "./core/schedule.js";
export { computeFailedWorkflowRunUpdate } from "./core/workflow-definition.js";
export {
  isTerminalStatus,
  resolveCancelWorkflowRunConflict,
} from "./core/workflow-run.js";
