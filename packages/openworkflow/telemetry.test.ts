import { OpenWorkflow } from "./client/client.js";
import {
  DEFAULT_WORKFLOW_RETRY_POLICY,
  type Workflow,
} from "./core/workflow-definition.js";
import { BackendSqlite } from "./sqlite/backend.js";
import {
  ATTRIBUTE_NAMES,
  getOtelApi,
  EXECUTION_OUTCOMES,
  extractTraceContext,
  SPAN_NAMES,
  traceOperation,
  setAttributes,
  withoutActiveSpan,
} from "./telemetry.js";
import { executeWorkflow } from "./worker/execution.js";
import {
  context,
  INVALID_SPAN_CONTEXT,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer = trace.getTracer("test-application");
let backend: BackendSqlite;
let directory: string;
let databasePath: string;

describe("native OpenTelemetry instrumentation", () => {
  beforeAll(async () => {
    provider.register();
    await getOtelApi();
  });
  beforeEach(async () => {
    exporter.reset();
    directory = await mkdtemp(path.join(tmpdir(), "openworkflow-otel-"));
    databasePath = path.join(directory, "workflow.sqlite");
    backend = BackendSqlite.connect(databasePath);
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await backend.stop();
    await rm(directory, { recursive: true });
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  /**
   * Execute one real claim without a background worker or wall-clock polling.
   * @param workflow - Registered workflow
   * @param retryPolicy - Workflow retry policy
   * @returns The claimed run
   */
  async function executeNext(
    workflow: Workflow<unknown, unknown, unknown>,
    retryPolicy = DEFAULT_WORKFLOW_RETRY_POLICY,
  ) {
    const workerId = "test-worker";
    const workflowRun = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 30_000,
    });
    if (!workflowRun) throw new Error("Expected a runnable workflow");
    await executeWorkflow({
      backend,
      workflowRun,
      workflowFn: workflow.fn,
      workflowVersion: workflowRun.version,
      workerId,
      retryPolicy,
    });
    await provider.forceFlush();
    return workflowRun;
  }

  test("links separate executions after reopening storage without replaying step spans", async () => {
    const ow = new OpenWorkflow({ backend });
    let calls = 0;
    const workflow = ow.defineWorkflow(
      { name: "resume", version: "v2" },
      async ({ step }) => {
        const result = await step.run({ name: "first" }, () => {
          calls++;
          return tracer.startActiveSpan("application.work", (span) => {
            span.end();
            return 42;
          });
        });
        await step.sleep("pause", "1s");
        return step.run({ name: "second" }, () => result);
      },
    );
    const handle = await tracer.startActiveSpan("request", async (span) => {
      try {
        return await workflow.run();
      } finally {
        span.end();
      }
    });
    await executeNext(workflow.workflow);
    await backend.stop();
    backend = BackendSqlite.connect(databasePath);
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow);

    const spans = exporter.getFinishedSpans();
    const request = spans.find((span) => span.name === "request");
    assert.ok(request);
    const submission = spans.find(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_CREATE,
    );
    assert.ok(submission);
    const executions = spans.filter(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    const first = spans.filter(
      (span) =>
        span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE &&
        span.attributes[ATTRIBUTE_NAMES.STEP_NAME] === "first",
    );
    const second = spans.find(
      (span) =>
        span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE &&
        span.attributes[ATTRIBUTE_NAMES.STEP_NAME] === "second",
    );
    assert.ok(second);
    const user = spans.find((span) => span.name === "application.work");
    assert.ok(user);
    expect(submission.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(submission.kind).toBe(SpanKind.PRODUCER);
    expect(executions).toHaveLength(2);
    expect(
      new Set(executions.map((span) => span.spanContext().traceId)).size,
    ).toBe(2);
    for (const execution of executions) {
      expect(execution.parentSpanContext).toBeUndefined();
      expect(execution.kind).toBe(SpanKind.CONSUMER);
      expect(execution.links[0]?.context).toMatchObject({
        traceId: submission.spanContext().traceId,
        spanId: submission.spanContext().spanId,
        traceFlags: submission.spanContext().traceFlags,
      });
      expect(execution.spanContext().traceId).not.toBe(
        submission.spanContext().traceId,
      );
    }
    for (const span of [submission, ...executions]) {
      expect(span.attributes).toMatchObject({
        [ATTRIBUTE_NAMES.WORKFLOW_NAME]: "resume",
        [ATTRIBUTE_NAMES.WORKFLOW_VERSION]: "v2",
        [ATTRIBUTE_NAMES.NAMESPACE_ID]: "default",
        [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: handle.workflowRun.id,
      });
    }
    expect(
      executions.map(
        (span) => span.attributes[ATTRIBUTE_NAMES.EXECUTION_OUTCOME],
      ),
    ).toEqual([EXECUTION_OUTCOMES.SUSPENDED, EXECUTION_OUTCOMES.COMPLETED]);
    expect(executions[0]?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.EXECUTION_ATTEMPT]: 1,
      [ATTRIBUTE_NAMES.STEP_NAME]: "pause",
      [ATTRIBUTE_NAMES.STEP_KIND]: "sleep",
    });
    expect(executions[0]?.attributes[ATTRIBUTE_NAMES.STEP_RESUME_AT]).toEqual(
      expect.any(String),
    );
    expect(executions[1]?.attributes).not.toHaveProperty(
      ATTRIBUTE_NAMES.STEP_NAME,
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.attributes).toEqual({
      [ATTRIBUTE_NAMES.WORKFLOW_NAME]: "resume",
      [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: handle.workflowRun.id,
      [ATTRIBUTE_NAMES.STEP_NAME]: "first",
    });
    expect(second.attributes).toEqual({
      [ATTRIBUTE_NAMES.WORKFLOW_NAME]: "resume",
      [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: handle.workflowRun.id,
      [ATTRIBUTE_NAMES.STEP_NAME]: "second",
    });
    expect(spans).toHaveLength(7);
    expect(
      spans.every(
        (span) =>
          span.status.code === SpanStatusCode.UNSET && span.events.length === 0,
      ),
    ).toBe(true);
    expect(calls).toBe(1);
    expect(first[0]?.parentSpanContext?.spanId).toBe(
      executions[0]?.spanContext().spanId,
    );
    expect(second.parentSpanContext?.spanId).toBe(
      executions[1]?.spanContext().spanId,
    );
    expect(user.parentSpanContext?.spanId).toBe(first[0]?.spanContext().spanId);
    const completed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(completed?.output).toBe(42);
  });

  test("attributes suspension to an earlier signal timeout alongside a pending sleep", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "mixed-waits" }, () => {
      throw new Error("Expected to suspend before replay");
    });
    const handle = await workflow.run();
    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 30_000,
    });
    assert.ok(claimed);
    const timeoutAt = new Date(Date.now() + 5000);
    await backend.createStepAttempt({
      workflowRunId: claimed.id,
      workerId,
      stepName: "sleep-late",
      kind: "sleep",
      config: {},
      context: {
        kind: "sleep",
        resumeAt: new Date(Date.now() + 120_000).toISOString(),
      },
    });
    await backend.createStepAttempt({
      workflowRunId: claimed.id,
      workerId,
      stepName: "wait-early",
      kind: "signal-wait",
      config: {},
      context: {
        kind: "signal-wait",
        signal: "approval",
        timeoutAt: timeoutAt.toISOString(),
      },
    });
    await backend.sleepWorkflowRun({
      workflowRunId: claimed.id,
      workerId,
      availableAt: new Date(),
    });
    await executeNext(workflow.workflow);

    const parked = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parked?.availableAt).toEqual(timeoutAt);
    const execution = exporter
      .getFinishedSpans()
      .find((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    expect(execution?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.STEP_NAME]: "wait-early",
      [ATTRIBUTE_NAMES.STEP_KIND]: "signal-wait",
      [ATTRIBUTE_NAMES.STEP_TIMEOUT_AT]: timeoutAt.toISOString(),
    });
  });

  test("retains the original submission context on idempotent starts", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow(
      { name: "dedupe" },
      async () => await Promise.resolve(1),
    );
    const first = await workflow.run(undefined, { idempotencyKey: "same" });
    const second = await workflow.run(undefined, { idempotencyKey: "same" });
    expect(second.workflowRun.id).toBe(first.workflowRun.id);
    expect(second.workflowRun.context).toEqual(first.workflowRun.context);
    await executeNext(workflow.workflow);
    const starts = exporter
      .getFinishedSpans()
      .filter((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_CREATE);
    const execution = exporter
      .getFinishedSpans()
      .find((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    assert.ok(execution);
    expect(starts).toHaveLength(2);
    expect(execution.links[0]?.context.spanId).toBe(
      starts[0]?.spanContext().spanId,
    );
    expect(execution.links[0]?.context.spanId).not.toBe(
      starts[1]?.spanContext().spanId,
    );
  });

  test("traces signal sends and suspended executions without exposing payloads", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow(
      { name: "approval" },
      async ({ step }) => {
        const result = await step.waitForSignal({
          name: "approval",
          signal: "order:123",
        });
        await step.sleep("pause", "1s");
        return result;
      },
    );
    const handle = await workflow.run();
    await executeNext(workflow.workflow);
    const received = await tracer.startActiveSpan(
      "send-request",
      async (span) => {
        try {
          return await ow.sendSignal({
            signal: "order:123",
            data: { secret: "private-signal-payload" },
          });
        } finally {
          span.end();
        }
      },
    );
    expect(received.workflowRunIds).toEqual([handle.workflowRun.id]);
    await executeNext(workflow.workflow);
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow);

    const spans = exporter.getFinishedSpans();
    const send = spans.find((span) => span.name === SPAN_NAMES.SIGNAL_SEND);
    const request = spans.find((span) => span.name === "send-request");
    assert.ok(send && request);
    expect(send.kind).toBe(SpanKind.PRODUCER);
    expect(send.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(send.attributes[ATTRIBUTE_NAMES.SIGNAL_RECIPIENT_COUNT]).toBe(1);
    expect(send.attributes[ATTRIBUTE_NAMES.SIGNAL_NAME]).toBe("order:123");
    expect(new Set(spans.map((span) => span.name))).toEqual(
      new Set([
        SPAN_NAMES.WORKFLOW_RUN_CREATE,
        SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
        SPAN_NAMES.SIGNAL_SEND,
        "send-request",
      ]),
    );
    const suspended = spans.find(
      (span) =>
        span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE &&
        span.attributes[ATTRIBUTE_NAMES.STEP_KIND] === "signal-wait",
    );
    expect(suspended?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.STEP_NAME]: "approval",
      [ATTRIBUTE_NAMES.SIGNAL_NAME]: "order:123",
      [ATTRIBUTE_NAMES.EXECUTION_OUTCOME]: EXECUTION_OUTCOMES.SUSPENDED,
    });
    expect(suspended?.attributes[ATTRIBUTE_NAMES.STEP_TIMEOUT_AT]).toEqual(
      expect.any(String),
    );
    expect(
      JSON.stringify(
        spans.map((span) => ({
          attributes: span.attributes,
          events: span.events,
        })),
      ),
    ).not.toContain("private-signal-payload");
    const finished = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(finished?.output).toEqual({
      data: { secret: "private-signal-payload" },
    });
  });

  test("completes a timed-out signal wait without marking it as an error", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "timeout" }, async ({ step }) =>
      step.waitForSignal({ signal: "approval", timeout: "1s" }),
    );
    const handle = await workflow.run();
    await executeNext(workflow.workflow);
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow);
    const spans = exporter.getFinishedSpans();
    expect(
      spans.every(
        (span) =>
          span.status.code === SpanStatusCode.UNSET && span.events.length === 0,
      ),
    ).toBe(true);
    const finished = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(finished?.output).toBeNull();
  });

  test("records a workflow's signal send once across replay", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "sender" }, async ({ step }) => {
      await step.sendSignal({
        name: "notify",
        signal: "unmatched",
        data: "private-signal-payload",
      });
      await step.sleep("pause", "1s");
    });
    await workflow.run();
    await executeNext(workflow.workflow);
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow);
    const sends = exporter
      .getFinishedSpans()
      .filter((span) => span.name === SPAN_NAMES.SIGNAL_SEND);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.STEP_NAME]: "notify",
      [ATTRIBUTE_NAMES.SIGNAL_RECIPIENT_COUNT]: 0,
    });
    expect(sends[0]?.status.code).toBe(SpanStatusCode.UNSET);
    const execution = exporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.spanContext().spanId === sends[0]?.parentSpanContext?.spanId,
      );
    expect(execution?.name).toBe(SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
  });

  test("records signal validation failure on execution", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow(
      { name: "validation" },
      async ({ step }) =>
        step.waitForSignal({
          signal: "approval",
          schema: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: () => ({ issues: [{ message: "invalid approval" }] }),
            },
          },
        }),
    );
    await workflow.run();
    await executeNext(workflow.workflow);
    await ow.sendSignal({ signal: "approval", data: "private-signal-payload" });
    await executeNext(workflow.workflow);
    const spans = exporter.getFinishedSpans();
    const execution = spans.findLast(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    expect(execution?.status.code).toBe(SpanStatusCode.ERROR);
    expect(execution?.events[0]?.attributes?.["exception.message"]).toContain(
      "invalid approval",
    );
  });

  test("links cancellation to creation and keeps the caller context", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "cancel" }, () => 1);
    const handle = await workflow.run();
    await tracer.startActiveSpan("cancel-request", async (span) => {
      try {
        await ow.cancelWorkflowRun(handle.workflowRun.id);
      } finally {
        span.end();
      }
    });
    const spans = exporter.getFinishedSpans();
    const cancellations = spans.filter(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_CANCEL,
    );
    const creation = spans.find(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_CREATE,
    );
    const request = spans.find((span) => span.name === "cancel-request");
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: handle.workflowRun.id,
    });
    expect(cancellations[0]?.links[0]?.context.spanId).toBe(
      creation?.spanContext().spanId,
    );
    expect(cancellations[0]?.parentSpanContext?.spanId).toBe(
      request?.spanContext().spanId,
    );
    expect(cancellations[0]?.status.code).toBe(SpanStatusCode.UNSET);
  });

  test("traces worker execution without claim or result polling spans", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "result" }, () => 42);
    const handle = await workflow.run();
    const worker = ow.newWorker();
    const lookup = vi.spyOn(backend, "getWorkflowRun");
    const result = handle.result({ timeoutMs: 10_000 });
    try {
      await vi.waitFor(() => {
        expect(lookup).toHaveBeenCalledWith({
          workflowRunId: handle.workflowRun.id,
        });
      });
      await worker.start();
      expect(await result).toBe(42);
    } finally {
      await worker.stop();
    }
    expect(lookup.mock.calls.length).toBeGreaterThan(1);
    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual([
      SPAN_NAMES.WORKFLOW_RUN_CREATE,
      SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    ]);
    const creation = spans[0];
    const execution = spans[1];
    expect(execution?.links[0]?.context.spanId).toBe(
      creation?.spanContext().spanId,
    );
    expect(execution?.parentSpanContext).toBeUndefined();
  });

  test("keeps idle workers silent", async () => {
    const ow = new OpenWorkflow({ backend });
    const worker = ow.newWorker();
    const claims = vi.spyOn(backend, "claimWorkflowRun");
    try {
      await worker.start();
      await vi.waitFor(() => {
        expect(claims.mock.calls.length).toBeGreaterThan(1);
      });
    } finally {
      await worker.stop();
    }
    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  test.each(["before", "after"] as const)(
    "starts one worker loop when the context manager throws %s its callback",
    async (when) => {
      const ow = new OpenWorkflow({ backend });
      const callback = vi.fn(() => 42);
      const workflow = ow.defineWorkflow({ name: "context-failure" }, callback);
      const handle = await workflow.run();
      const worker = ow.newWorker();
      const firstTick = Promise.withResolvers<number>();
      const tick = vi
        .spyOn(worker, "tick")
        .mockReturnValueOnce(firstTick.promise);
      vi.spyOn(context, "with").mockImplementationOnce((_parent, fn) => {
        if (when === "after") void fn();
        throw new Error("broken context manager");
      });
      try {
        await worker.start();
        expect(tick).toHaveBeenCalledTimes(1);
        firstTick.resolve(0);
        expect(await handle.result({ timeoutMs: 10_000 })).toBe(42);
        expect(callback).toHaveBeenCalledTimes(1);
      } finally {
        firstTick.resolve(0);
        await worker.stop();
      }
    },
  );

  test("records a failed step attempt and its retry without marking success OK", async () => {
    const ow = new OpenWorkflow({ backend });
    let attempts = 0;
    const workflow = ow.defineWorkflow({ name: "retry" }, async ({ step }) =>
      step.run({ name: "payment" }, () => {
        if (attempts++ === 0) throw new Error("try again");
        return "paid";
      }),
    );
    await workflow.run();
    await executeNext(workflow.workflow);
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow);
    const spans = exporter.getFinishedSpans();
    const steps = spans.filter(
      (span) => span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE,
    );
    const executions = spans.filter(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    expect(steps.map((span) => span.status.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.UNSET,
    ]);
    expect(steps[0]?.events[0]?.attributes?.["exception.message"]).toBe(
      "try again",
    );
    expect(steps[0]?.events).toHaveLength(1);
    expect(executions.map((span) => span.status.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.UNSET,
    ]);
    expect(executions[0]?.status.message).toBe("try again");
    expect(executions[0]?.attributes[ATTRIBUTE_NAMES.ERROR_TYPE]).toBe("Error");
    expect(executions.flatMap((span) => span.events)).toEqual([]);
    expect(
      executions.map(
        (span) => span.attributes[ATTRIBUTE_NAMES.EXECUTION_OUTCOME],
      ),
    ).toEqual([EXECUTION_OUTCOMES.RETRYING, EXECUTION_OUTCOMES.COMPLETED]);
  });

  test("records workflow retries outside step callbacks", async () => {
    const ow = new OpenWorkflow({ backend });
    const retryPolicy = {
      ...DEFAULT_WORKFLOW_RETRY_POLICY,
      maximumAttempts: 2,
    };
    const workflow = ow.defineWorkflow(
      { name: "retry-workflow", retryPolicy },
      () => {
        throw new Error("try again");
      },
    );
    const handle = await workflow.run();
    await executeNext(workflow.workflow, retryPolicy);
    const retrying = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(retrying?.status).toBe("pending");
    vi.setSystemTime(Date.now() + 2000);
    await executeNext(workflow.workflow, retryPolicy);
    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(failed?.status).toBe("failed");
    const executions = exporter
      .getFinishedSpans()
      .filter((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    expect(
      executions.map(
        (span) => span.attributes[ATTRIBUTE_NAMES.EXECUTION_OUTCOME],
      ),
    ).toEqual([EXECUTION_OUTCOMES.RETRYING, EXECUTION_OUTCOMES.FAILED]);
    expect(executions.map((span) => span.status.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.ERROR,
    ]);
    expect(executions.map((span) => span.events.length)).toEqual([1, 1]);
  });

  test("records a reused error once per concurrent execution and retry", async () => {
    const ow = new OpenWorkflow({ backend });
    const error: Error = Object.freeze(new Error("try again"));
    const workflow = ow.defineWorkflow(
      { name: "reused-error" },
      async ({ step }) =>
        step.run({ name: "work" }, () => {
          throw error;
        }),
    );
    await Promise.all([workflow.run(), workflow.run()]);
    await Promise.all([
      executeNext(workflow.workflow),
      executeNext(workflow.workflow),
    ]);
    vi.setSystemTime(Date.now() + 2000);
    await Promise.all([
      executeNext(workflow.workflow),
      executeNext(workflow.workflow),
    ]);
    const spans = exporter.getFinishedSpans();
    const callbacks = spans.filter(
      (span) => span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE,
    );
    expect(callbacks.map((span) => span.events.length)).toEqual([1, 1, 1, 1]);
    const executions = spans.filter(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    expect(executions.map((span) => span.events.length)).toEqual([0, 0, 0, 0]);
  });

  test("isolates concurrent executions from each other and a shared polling span", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow(
      { name: "concurrent" },
      async ({ step }) =>
        step.run({ name: "work" }, async () => {
          await Promise.resolve();
          return tracer.startActiveSpan("user.child", (span) => {
            span.end();
            return 1;
          });
        }),
    );
    await Promise.all([workflow.run(), workflow.run()]);
    await tracer.startActiveSpan("poll", async (span) => {
      try {
        await Promise.all([
          executeNext(workflow.workflow),
          executeNext(workflow.workflow),
        ]);
      } finally {
        span.end();
      }
    });
    const spans = exporter.getFinishedSpans();
    const executions = spans.filter(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    const poll = spans.find((span) => span.name === "poll");
    assert.ok(poll);
    expect(executions).toHaveLength(2);
    expect(
      new Set(executions.map((span) => span.spanContext().traceId)).size,
    ).toBe(2);
    for (const execution of executions) {
      expect(execution.parentSpanContext).toBeUndefined();
      expect(execution.spanContext().traceId).not.toBe(
        poll.spanContext().traceId,
      );
      const step = spans.find(
        (span) =>
          span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE &&
          span.spanContext().traceId === execution.spanContext().traceId,
      );
      assert.ok(step);
      expect(step.parentSpanContext?.spanId).toBe(
        execution.spanContext().spanId,
      );
      const child = spans.find(
        (span) =>
          span.name === "user.child" &&
          span.spanContext().traceId === execution.spanContext().traceId,
      );
      assert.ok(child);
      expect(child.parentSpanContext?.spanId).toBe(step.spanContext().spanId);
    }
  });

  test("links child workflow executions to their own submission", async () => {
    const ow = new OpenWorkflow({ backend });
    const child = ow.defineWorkflow(
      { name: "child" },
      async () => await Promise.resolve(42),
    );
    const parent = ow.defineWorkflow({ name: "parent" }, async ({ step }) =>
      step.runWorkflow(child.workflow.spec),
    );
    await parent.run();
    await executeNext(parent.workflow);
    const childRun = await executeNext(child.workflow);
    await executeNext(parent.workflow);
    const spans = exporter.getFinishedSpans();
    const submission = spans.find(
      (span) =>
        span.name === SPAN_NAMES.WORKFLOW_RUN_CREATE &&
        span.attributes[ATTRIBUTE_NAMES.WORKFLOW_NAME] === "child",
    );
    assert.ok(submission);
    const execution = spans.find(
      (span) =>
        span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE &&
        span.attributes[ATTRIBUTE_NAMES.WORKFLOW_NAME] === "child",
    );
    assert.ok(execution);
    expect(submission.attributes[ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]).toBe(
      childRun.id,
    );
    expect(execution.links[0]?.context.spanId).toBe(
      submission.spanContext().spanId,
    );
    expect(execution.spanContext().traceId).not.toBe(
      submission.spanContext().traceId,
    );
    const parentExecution = spans.find(
      (span) =>
        span.spanContext().spanId === submission.parentSpanContext?.spanId,
    );
    assert.ok(parentExecution);
    expect(parentExecution.name).toBe(SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    expect(parentExecution.attributes[ATTRIBUTE_NAMES.WORKFLOW_NAME]).toBe(
      "parent",
    );
    expect(parentExecution.attributes[ATTRIBUTE_NAMES.STEP_KIND]).toBe(
      "workflow",
    );
    expect(
      parentExecution.attributes[ATTRIBUTE_NAMES.CHILD_WORKFLOW_RUN_ID],
    ).toBe(childRun.id);
    expect(spans).toHaveLength(5);
  });

  test("preserves unsampled origin flags and baggage without inheriting the origin sampling decision", async () => {
    const ow = new OpenWorkflow({ backend });
    let baggage: string | undefined;
    const workflow = ow.defineWorkflow({ name: "sampled" }, async () => {
      await Promise.resolve();
      baggage = propagation
        .getBaggage(context.active())
        ?.getEntry("example")?.value;
    });
    const origin = propagation.setBaggage(
      trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "12345678901234567890123456789012",
        spanId: "1234567890123456",
        traceFlags: TraceFlags.NONE,
        isRemote: true,
      }),
      propagation.createBaggage({ example: { value: "retained" } }),
    );
    await context.with(origin, () => workflow.run());
    await executeNext(workflow.workflow);
    const execution = exporter
      .getFinishedSpans()
      .find((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    assert.ok(execution);
    expect(execution.links[0]?.context.traceFlags).toBe(TraceFlags.NONE);
    expect(execution.spanContext().traceFlags).toBe(TraceFlags.SAMPLED);
    expect(baggage).toBe("retained");
    expect(execution.attributes).not.toHaveProperty("example");
  });

  test("keeps execution outcome separate from a concurrently canceled run", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow(
      { name: "canceled" },
      async ({ run }) => {
        await backend.cancelWorkflowRun({ workflowRunId: run.id });
        return "finished locally";
      },
    );
    const handle = await workflow.run();
    await executeNext(workflow.workflow);
    const execution = exporter
      .getFinishedSpans()
      .find((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE);
    assert.ok(execution);
    expect(execution.attributes[ATTRIBUTE_NAMES.EXECUTION_OUTCOME]).toBe(
      EXECUTION_OUTCOMES.COMPLETED,
    );
    const canceled = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(canceled?.status).toBe("canceled");
    expect(execution.status.code).toBe(SpanStatusCode.UNSET);
  });

  test("records error types and descriptions for failed operations", async () => {
    const ow = new OpenWorkflow({ backend });
    const workflow = ow.defineWorkflow({ name: "errors" }, async ({ step }) =>
      step.run({ name: "work" }, () => {
        throw new TypeError("bad value");
      }),
    );
    await workflow.run();
    await executeNext(workflow.workflow);
    vi.spyOn(backend, "cancelWorkflowRun").mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(ow.cancelWorkflowRun("missing")).rejects.toThrow(
      "unavailable",
    );
    await expect(
      // @ts-expect-error deliberately invalid input tests runtime validation
      workflow.run(undefined, { availableAt: "invalid" }),
    ).rejects.toThrow();
    const spans = exporter.getFinishedSpans();
    const callback = spans.find(
      (span) => span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE,
    );
    expect(callback?.attributes).toMatchObject({
      [ATTRIBUTE_NAMES.ERROR_TYPE]: "TypeError",
    });
    expect(callback?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "bad value",
    });
    expect(
      spans.find((span) => span.name === SPAN_NAMES.WORKFLOW_RUN_CANCEL)
        ?.status,
    ).toEqual({ code: SpanStatusCode.ERROR, message: "unavailable" });
    expect(
      spans.find(
        (span) =>
          span.name === SPAN_NAMES.WORKFLOW_RUN_CREATE &&
          span.status.code === SpanStatusCode.ERROR,
      )?.attributes[ATTRIBUTE_NAMES.ERROR_TYPE],
    ).toBeDefined();
  });

  test.each(["completeStepAttempt", "failStepAttempt"] as const)(
    "records a persistence failure from %s on execution",
    async (method) => {
      const ow = new OpenWorkflow({ backend });
      const callbackError = new Error("storage unavailable");
      const persistenceError = new Error("storage unavailable");
      vi.spyOn(backend, method).mockRejectedValueOnce(persistenceError);
      const workflow = ow.defineWorkflow(
        { name: "persistence" },
        async ({ step }) =>
          step.run({ name: "save" }, () => {
            if (method === "failStepAttempt") throw callbackError;
            return 42;
          }),
      );
      await workflow.run();
      await executeNext(workflow.workflow);
      const spans = exporter.getFinishedSpans();
      const execution = spans.find(
        (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
      );
      expect(execution?.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: persistenceError.message,
      });
      expect(
        execution?.events.map(
          (event) => event.attributes?.["exception.stacktrace"],
        ),
      ).toEqual([persistenceError.stack]);
      const callback = spans.find(
        (span) => span.name === SPAN_NAMES.STEP_ATTEMPT_EXECUTE,
      );
      expect(callback?.status.code).toBe(
        method === "failStepAttempt"
          ? SpanStatusCode.ERROR
          : SpanStatusCode.UNSET,
      );
      expect(
        callback?.events.map(
          (event) => event.attributes?.["exception.stacktrace"],
        ),
      ).toEqual(method === "failStepAttempt" ? [callbackError.stack] : []);
      expect(spans.map((span) => span.name)).toEqual([
        SPAN_NAMES.WORKFLOW_RUN_CREATE,
        SPAN_NAMES.STEP_ATTEMPT_EXECUTE,
        SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
      ]);
    },
  );

  test("records the exception on execution if recording it on the callback fails", async () => {
    const error = new Error("callback failed");
    await expect(
      traceOperation(SPAN_NAMES.WORKFLOW_RUN_EXECUTE, {}, () =>
        traceOperation(SPAN_NAMES.STEP_ATTEMPT_EXECUTE, {}, (span) => {
          assert.ok(span);
          vi.spyOn(span, "recordException").mockImplementation(() => {
            throw new Error("broken span");
          });
          throw error;
        }),
      ),
    ).rejects.toBe(error);
    const spans = exporter.getFinishedSpans();
    const execution = spans.find(
      (span) => span.name === SPAN_NAMES.WORKFLOW_RUN_EXECUTE,
    );
    expect(execution?.events[0]?.attributes?.["exception.stacktrace"]).toBe(
      error.stack,
    );
    expect(spans.flatMap((span) => span.events)).toHaveLength(1);
  });

  test("keeps concurrent heartbeats bound to their executions after a failure", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const consoleError = vi.spyOn(console, "error").mockReturnValue();
    const ow = new OpenWorkflow({ backend });
    const gate = Promise.withResolvers<void>();
    const executionSpans = new Map<string, string | undefined>();
    const heartbeatSpans = new Map<string, string | undefined>();
    const extendLease = backend.extendWorkflowRunLease.bind(backend);
    const heartbeat = vi
      .spyOn(backend, "extendWorkflowRunLease")
      .mockImplementation(async (params) => {
        heartbeatSpans.set(
          params.workflowRunId,
          trace.getActiveSpan()?.spanContext().spanId,
        );
        return await extendLease(params);
      });
    const workflow = ow.defineWorkflow(
      { name: "heartbeat" },
      async ({ run, step }) => {
        executionSpans.set(run.id, trace.getActiveSpan()?.spanContext().spanId);
        await step.run({ name: "hold" }, async () => gate.promise);
      },
    );
    const worker = ow.newWorker({ concurrency: 2 });
    try {
      await workflow.run();
      await workflow.run();
      await worker.tick();
      await vi.waitFor(() => {
        expect(executionSpans.size).toBe(2);
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(heartbeatSpans).toEqual(executionSpans);
      expect(new Set(executionSpans.values()).size).toBe(2);
      expect([...executionSpans.values()]).not.toContain(undefined);

      const error = new Error("Lease renewal failed");
      heartbeat.mockRejectedValueOnce(error);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(consoleError).toHaveBeenCalledWith("Heartbeat failed:", error);

      heartbeatSpans.clear();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(heartbeatSpans).toEqual(executionSpans);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
      await worker.stop();
    }
    const calls = heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(calls);
  });

  test.each(["before", "after"] as const)(
    "runs work once when tracing fails %s the callback",
    async (when) => {
      const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
      vi.spyOn(
        provider.getTracer("openworkflow"),
        "startActiveSpan",
      ).mockImplementation((_name, _options, _context, callback) => {
        if (when === "after") {
          void callback(span);
        }
        throw new Error("broken provider");
      });
      const success = vi.fn<() => Promise<number>>().mockResolvedValue(42);
      await expect(
        traceOperation(SPAN_NAMES.WORKFLOW_RUN_CREATE, {}, success),
      ).resolves.toBe(42);
      expect(success).toHaveBeenCalledTimes(1);
      const original = new Error("original failure");
      const failure = vi.fn<() => Promise<never>>().mockRejectedValue(original);
      await expect(
        traceOperation(SPAN_NAMES.WORKFLOW_RUN_CREATE, {}, failure),
      ).rejects.toBe(original);
      expect(failure).toHaveBeenCalledTimes(1);
    },
  );

  test("does not retry a failed callback while detaching context", async () => {
    const original = new Error("original failure");
    const thrown = vi.fn<() => Promise<never>>(() => {
      throw original;
    });
    await expect(withoutActiveSpan(thrown)).rejects.toBe(original);
    expect(thrown).toHaveBeenCalledTimes(1);
  });

  test("preserves results and thrown values when diagnostic writes fail", async () => {
    const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
    vi.spyOn(span, "isRecording").mockReturnValue(true);
    for (const method of [
      "setAttributes",
      "recordException",
      "setStatus",
      "end",
    ] as const) {
      vi.spyOn(span, method).mockImplementation(() => {
        throw new Error("broken span");
      });
    }
    vi.spyOn(
      provider.getTracer("openworkflow"),
      "startActiveSpan",
    ).mockImplementation((_name, _options, _context, callback) =>
      callback(span),
    );
    await expect(
      traceOperation(SPAN_NAMES.WORKFLOW_RUN_CREATE, {}, (activeSpan) => {
        setAttributes(activeSpan, {
          [ATTRIBUTE_NAMES.WORKFLOW_RUN_ID]: "test",
        });
        return Promise.resolve(42);
      }),
    ).resolves.toBe(42);
    const original = {
      toString() {
        throw new Error("cannot format");
      },
    };
    await expect(
      traceOperation(
        SPAN_NAMES.WORKFLOW_RUN_CREATE,
        {},
        vi.fn<() => Promise<never>>().mockRejectedValue(original),
      ),
    ).rejects.toBe(original);
  });

  test.each([
    null,
    {},
    { traceContext: { traceparent: "invalid" } },
    { traceContext: { traceparent: 42 } },
  ])(
    "does not inherit ambient context from missing or invalid stored metadata: %j",
    (metadata) => {
      tracer.startActiveSpan("poll", (span) => {
        try {
          const restored = extractTraceContext(metadata);
          assert.ok(restored);
          expect(trace.getSpanContext(restored)?.isRemote ?? false).toBe(false);
          expect(trace.getSpanContext(restored)).toBeUndefined();
        } finally {
          span.end();
        }
      });
    },
  );
});
