import type { JsonValue } from "./core/json.js";
import type { StepAttempt } from "./core/step-attempt.js";
import type { WorkflowRun } from "./core/workflow-run.js";
import type { Context, Span, SpanKind, SpanOptions } from "@opentelemetry/api";

type Attributes = NonNullable<SpanOptions["attributes"]>;
type AttributeValue = Parameters<Span["setAttribute"]>[1];

export const SPAN_NAMES = {
  WORKFLOW_RUN_CREATE: "workflow_run.create",
  WORKFLOW_RUN_EXECUTE: "workflow_run.execute",
  WORKFLOW_RUN_CANCEL: "workflow_run.cancel",
  STEP_ATTEMPT_EXECUTE: "step_attempt.execute",
  SIGNAL_SEND: "signal.send",
} as const;

export const ATTRIBUTE_NAMES = {
  WORKFLOW_NAME: "openworkflow.workflow.name",
  WORKFLOW_VERSION: "openworkflow.workflow.version",
  NAMESPACE_ID: "openworkflow.namespace.id",
  WORKFLOW_RUN_ID: "openworkflow.run.id",
  PARENT_WORKFLOW_RUN_ID: "openworkflow.parent.run.id",
  STEP_NAME: "openworkflow.step.name",
  STEP_KIND: "openworkflow.step.kind",
  CHILD_WORKFLOW_RUN_ID: "openworkflow.child.run.id",
  STEP_RESUME_AT: "openworkflow.step.resume_at",
  STEP_TIMEOUT_AT: "openworkflow.step.timeout_at",
  EXECUTION_ATTEMPT: "openworkflow.execution.attempt",
  EXECUTION_OUTCOME: "openworkflow.execution.outcome",
  SIGNAL_NAME: "openworkflow.signal.name",
  SIGNAL_RECIPIENT_COUNT: "openworkflow.signal.recipient_count",
  ERROR_TYPE: "error.type",
} as const;

export const EXECUTION_OUTCOMES = {
  COMPLETED: "completed",
  SUSPENDED: "suspended",
  RETRYING: "retrying",
  FAILED: "failed",
  STALE: "stale",
} as const;

const TRACE_CONTEXT_KEY = "traceContext";
const RECORDED_EXCEPTIONS = Symbol("openworkflow.recordedExceptions");

type OtelApi = typeof import("@opentelemetry/api");
let otel: OtelApi | undefined;
let otelPromise: Promise<OtelApi | undefined> | undefined;

// Keep the literal import so bundlers can include the peer when it is installed.
export function getOtelApi(): Promise<OtelApi | undefined> {
  otelPromise ??= (async () => {
    try {
      otel = await import("@opentelemetry/api");
    } catch {
      // The application has not installed the optional peer.
    }
    return otel;
  })();
  return otelPromise;
}

export async function getSpanKind(
  kind: keyof typeof SpanKind,
): Promise<SpanKind | undefined> {
  const api = await getOtelApi();
  return api?.SpanKind[kind];
}

// Telemetry failures must not change the operation being observed.
function observe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// Timers may invoke callbacks outside the context in which they were registered.
export function bindActiveTraceContext(fn: () => void): () => void {
  return observe(() => otel?.context.bind(otel.context.active(), fn)) ?? fn;
}

// Worker polling must not inherit the trace that started the worker.
export async function withoutActiveSpan<T>(fn: () => Promise<T>): Promise<T> {
  const api = await getOtelApi();
  if (!api) return fn();
  let operation: Promise<T> | undefined;
  const run = (): Promise<T> => {
    operation ??= (async () => fn())();
    return operation;
  };
  try {
    return await api.context.with(
      api.trace.deleteSpan(api.context.active()),
      run,
    );
  } catch {
    // The context manager may throw after starting the loop. Do not start it twice.
    return await (operation ?? run());
  }
}

// Skip diagnostic writes once a span stops recording.
export function setAttributes(
  span: Span | undefined,
  attributes: Attributes,
): void {
  observe(() => {
    if (span?.isRecording()) span.setAttributes(attributes);
  });
}

// Share the same failure handling for single-attribute writes.
export function setAttribute(
  span: Span | undefined,
  name: string,
  value: AttributeValue,
): void {
  setAttributes(span, { [name]: value });
}

// Workflow identity for run spans.
export function workflowRunAttributes(run: Readonly<WorkflowRun>): Attributes {
  const attributes: Attributes = {
    [ATTRIBUTE_NAMES.WORKFLOW_NAME]: run.workflowName,
    [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: run.id,
    [ATTRIBUTE_NAMES.NAMESPACE_ID]: run.namespaceId,
  };
  if (run.version !== null) {
    attributes[ATTRIBUTE_NAMES.WORKFLOW_VERSION] = run.version;
  }
  return attributes;
}

/**
 * Attributes shared by operations on a persisted step attempt.
 * @param attempt - Step attempt
 * @returns Step identity and kind, without its input or output
 */
export function stepAttemptAttributes(
  attempt: Readonly<StepAttempt>,
): Attributes {
  const attributes: Attributes = {
    [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: attempt.workflowRunId,
    [ATTRIBUTE_NAMES.STEP_NAME]: attempt.stepName,
  };
  if (attempt.kind !== "function" && attempt.kind !== "signal-send") {
    attributes[ATTRIBUTE_NAMES.STEP_KIND] = attempt.kind;
  }
  if (attempt.childWorkflowRunId) {
    attributes[ATTRIBUTE_NAMES.CHILD_WORKFLOW_RUN_ID] =
      attempt.childWorkflowRunId;
  }
  if (attempt.context?.kind === "sleep") {
    attributes[ATTRIBUTE_NAMES.STEP_RESUME_AT] = attempt.context.resumeAt;
  } else if (attempt.context?.kind === "signal-wait") {
    attributes[ATTRIBUTE_NAMES.SIGNAL_NAME] = attempt.context.signal;
    attributes[ATTRIBUTE_NAMES.STEP_TIMEOUT_AT] = attempt.context.timeoutAt;
  } else if (
    attempt.context?.kind === "workflow" &&
    attempt.context.timeoutAt
  ) {
    attributes[ATTRIBUTE_NAMES.STEP_TIMEOUT_AT] = attempt.context.timeoutAt;
  }
  return attributes;
}

/**
 * Link an operation to the creation span stored with its workflow run.
 * @param span - Current operation
 * @param metadata - Stored workflow run context
 */
export function linkToCreationSpan(
  span: Span | undefined,
  metadata: JsonValue | null,
): void {
  observe(() => {
    const parent = extractTraceContext(metadata);
    const origin = parent && otel?.trace.getSpanContext(parent);
    // Older 1.x providers only accept links at span creation.
    if (
      origin &&
      otel?.isSpanContextValid(origin) &&
      typeof span?.addLink === "function"
    ) {
      span.addLink({ context: origin });
    }
  });
}

/**
 * Trace an operation with the application's provider and active context.
 * @param name - Operation name
 * @param options - Span kind, attributes, and links
 * @param fn - Operation to execute
 * @param parent - Parent context, or the active context when omitted
 * @returns The operation's result
 */
export async function traceOperation<T>(
  name: string,
  options: Omit<SpanOptions, "kind"> & { kind?: SpanKind | undefined },
  fn: (span?: Span) => Promise<T>,
  parent?: Context,
): Promise<T> {
  const api = await getOtelApi();
  if (!api) return fn();
  const { kind, ...rest } = options;
  const spanOptions: SpanOptions = rest;
  if (kind !== undefined) spanOptions.kind = kind;
  let operation: Promise<T> | undefined;
  const run = (span?: Span): Promise<T> => {
    operation ??= (async () => {
      try {
        return await fn(span);
      } catch (error) {
        observe(() => {
          recordError(span, error);
        });
        throw error;
      } finally {
        observe(() => {
          span?.end();
        });
      }
    })();
    return operation;
  };
  try {
    const parentContext = parent ?? api.context.active();
    // Nested operations share exception records; separate executions do not.
    const operationContext = parentContext.getValue(RECORDED_EXCEPTIONS)
      ? parentContext
      : parentContext.setValue(RECORDED_EXCEPTIONS, new Set<unknown>());
    return await api.trace
      .getTracer("openworkflow")
      .startActiveSpan(name, spanOptions, operationContext, run);
  } catch {
    // A provider can fail before or after invoking its callback. Never repeat work.
    return await (operation ?? run());
  }
}

/**
 * Record an operation failure without changing the thrown value.
 * @param span - Span for the failed operation
 * @param cause - Original failure
 */
export function recordError(span: Span | undefined, cause: unknown): void {
  if (!span || !otel || !observe(() => span.isRecording())) return;
  const errorStatus = otel.SpanStatusCode.ERROR;
  const message =
    observe(() => (cause instanceof Error ? cause.message : String(cause))) ??
    "Unknown error";
  const type =
    observe(() => (cause instanceof Error ? cause.name : typeof cause)) ??
    "unknown";
  setAttributes(span, {
    [ATTRIBUTE_NAMES.ERROR_TYPE]: type,
  });
  observe(() => {
    const recorded = otel?.context.active().getValue(RECORDED_EXCEPTIONS) as
      Set<unknown> | undefined;
    if (!recorded?.has(cause)) {
      span.recordException(cause instanceof Error ? cause : message);
      recorded?.add(cause);
    }
  });
  observe(() => span.setStatus({ code: errorStatus, message }));
}

/**
 * Capture the active submission context for durable run correlation.
 * @returns Propagated context, or null when there is none
 */
export function captureTraceContext(): JsonValue | null {
  const carrier: Record<string, string> = {};
  observe(() => {
    otel?.propagation.inject(otel.context.active(), carrier);
  });
  return Object.keys(carrier).length > 0
    ? { [TRACE_CONTEXT_KEY]: carrier }
    : null;
}

/**
 * Extract the stored origin independently of the worker's ambient context.
 * Old runs and malformed carriers start with an empty context.
 * @param metadata - Stored workflow run context
 * @returns The propagated submission context
 */
export function extractTraceContext(
  metadata: JsonValue | null,
): Context | undefined {
  if (!otel) return undefined;
  const { ROOT_CONTEXT, propagation } = otel;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return ROOT_CONTEXT;
  }
  const carrier = metadata[TRACE_CONTEXT_KEY];
  if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) {
    return ROOT_CONTEXT;
  }
  if (!Object.values(carrier).every((value) => typeof value === "string")) {
    return ROOT_CONTEXT;
  }
  return (
    observe(() => propagation.extract(ROOT_CONTEXT, carrier)) ?? ROOT_CONTEXT
  );
}
