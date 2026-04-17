import type { StepAttempt } from "../core/step-attempt.js";
import { StepHistory, StepLimitExceededError } from "./step-history.js";
import { describe, test, expect } from "vitest";

describe("StepHistory", () => {
  describe("resolveStepName", () => {
    test("returns the base name on first use", () => {
      const history = new StepHistory({ attempts: [] });
      expect(history.resolveStepName("step")).toBe("step");
    });

    test("appends incrementing suffixes for collisions", () => {
      const history = new StepHistory({ attempts: [] });
      expect(history.resolveStepName("step")).toBe("step");
      expect(history.resolveStepName("step")).toBe("step:1");
      expect(history.resolveStepName("step")).toBe("step:2");
    });

    test("skips suffixes that were user-supplied as base names", () => {
      const history = new StepHistory({ attempts: [] });
      history.resolveStepName("step");
      history.resolveStepName("step:1"); // user-supplied collision
      expect(history.resolveStepName("step")).toBe("step:2");
    });
  });

  describe("find*", () => {
    test("findCached returns successful attempts only", () => {
      const completed = createMockStepAttempt({
        stepName: "a",
        status: "completed",
        output: "done",
      });
      const failed = createMockStepAttempt({
        stepName: "b",
        status: "failed",
      });
      const history = new StepHistory({ attempts: [completed, failed] });

      expect(history.findCached("a")).toBe(completed);
      expect(history.findCached("b")).toBeUndefined();
    });

    test("findTerminallyFailedWorkflow requires linked child ids", () => {
      const unlinked = createMockStepAttempt({
        stepName: "a",
        kind: "workflow",
        status: "failed",
      });
      const linked = createMockStepAttempt({
        stepName: "b",
        kind: "workflow",
        status: "failed",
        childWorkflowRunNamespaceId: "default",
        childWorkflowRunId: "child-run",
      });
      const nonWorkflow = createMockStepAttempt({
        stepName: "c",
        kind: "function",
        status: "failed",
      });

      const history = new StepHistory({
        attempts: [unlinked, linked, nonWorkflow],
      });

      expect(history.findTerminallyFailedWorkflow("a")).toBeUndefined();
      expect(history.findTerminallyFailedWorkflow("b")).toBe(linked);
      expect(history.findTerminallyFailedWorkflow("c")).toBeUndefined();
    });

    test("findConflictingSignalWait matches signal name, excluding caller", () => {
      const waitingA = createMockStepAttempt({
        stepName: "wait-a",
        kind: "signal-wait",
        status: "running",
        context: {
          kind: "signal-wait",
          signal: "approve",
          timeoutAt: "2026-05-01T00:00:00.000Z",
        },
      });
      const waitingB = createMockStepAttempt({
        stepName: "wait-b",
        kind: "signal-wait",
        status: "running",
        context: {
          kind: "signal-wait",
          signal: "cancel",
          timeoutAt: "2026-05-01T00:00:00.000Z",
        },
      });

      const history = new StepHistory({ attempts: [waitingA, waitingB] });

      expect(history.findConflictingSignalWait("approve", "other")).toEqual({
        stepName: "wait-a",
        attempt: waitingA,
      });
      expect(history.findConflictingSignalWait("approve", "wait-a")).toBeNull();
      expect(history.findConflictingSignalWait("unknown", "other")).toBeNull();
    });
  });

  describe("mutations", () => {
    test("recordNewAttempt enforces the step limit", () => {
      const history = new StepHistory({ attempts: [], stepLimit: 1 });
      history.ensureCanRecordNewAttempt();
      history.recordNewAttempt(
        createMockStepAttempt({ id: "a", stepName: "a", status: "running" }),
      );
      expect(() => {
        history.ensureCanRecordNewAttempt();
      }).toThrow(StepLimitExceededError);
    });

    test("recordCompletion moves a running attempt into the cache", () => {
      const running = createMockStepAttempt({
        stepName: "a",
        status: "running",
      });
      const history = new StepHistory({ attempts: [running] });
      expect(history.findRunning("a")).toBe(running);
      expect(history.findCached("a")).toBeUndefined();

      const completed = createMockStepAttempt({
        stepName: "a",
        status: "completed",
        output: "value",
      });
      history.recordCompletion(completed);

      expect(history.findRunning("a")).toBeUndefined();
      expect(history.findCached("a")).toBe(completed);
    });

    test("recordFailedAttempt increments the failure count", () => {
      const running = createMockStepAttempt({
        stepName: "a",
        status: "running",
      });
      const history = new StepHistory({ attempts: [running] });

      const failed = createMockStepAttempt({
        stepName: "a",
        status: "failed",
      });
      expect(history.recordFailedAttempt(failed)).toBe(1);
      expect(history.recordFailedAttempt(failed)).toBe(2);
      expect(history.failedAttemptCount("a")).toBe(2);
      expect(history.findRunning("a")).toBeUndefined();
    });

    test("replaceRunningAttempt updates the running entry in place", () => {
      const initial = createMockStepAttempt({
        id: "attempt-1",
        stepName: "wf",
        kind: "workflow",
        status: "running",
      });
      const history = new StepHistory({
        attempts: [initial],
        stepLimit: 2,
      });

      const linked = {
        ...initial,
        childWorkflowRunId: "child-run",
        childWorkflowRunNamespaceId: "default",
      };
      history.replaceRunningAttempt(linked);

      expect(history.findRunning("wf")).toBe(linked);

      // Counter should not have moved, so we can still record a second attempt.
      history.ensureCanRecordNewAttempt();
    });
  });

  describe("wait-time helpers", () => {
    test("earliestRunningWaitResumeAt returns null with no running waits", () => {
      const history = new StepHistory({ attempts: [] });
      expect(history.earliestRunningWaitResumeAt()).toBeNull();
    });

    test("earliestRunningWaitResumeAt picks the earliest running wait", () => {
      const sleepLate = createMockStepAttempt({
        stepName: "sleep-late",
        kind: "sleep",
        status: "running",
        context: { kind: "sleep", resumeAt: "2026-06-01T00:00:00.000Z" },
      });
      const sleepEarly = createMockStepAttempt({
        stepName: "sleep-early",
        kind: "sleep",
        status: "running",
        context: { kind: "sleep", resumeAt: "2026-05-01T00:00:00.000Z" },
      });
      const history = new StepHistory({ attempts: [sleepLate, sleepEarly] });

      expect(history.earliestRunningWaitResumeAt()?.toISOString()).toBe(
        "2026-05-01T00:00:00.000Z",
      );
    });

    test("resolveEarliestRunningWaitResumeAt picks the earlier of fallback or running", () => {
      const sleep = createMockStepAttempt({
        stepName: "sleep",
        kind: "sleep",
        status: "running",
        context: { kind: "sleep", resumeAt: "2026-06-01T00:00:00.000Z" },
      });
      const history = new StepHistory({ attempts: [sleep] });

      const earlierFallback = new Date("2026-05-01T00:00:00.000Z");
      expect(
        history
          .resolveEarliestRunningWaitResumeAt(earlierFallback)
          .toISOString(),
      ).toBe("2026-05-01T00:00:00.000Z");

      const laterFallback = new Date("2026-07-01T00:00:00.000Z");
      expect(
        history.resolveEarliestRunningWaitResumeAt(laterFallback).toISOString(),
      ).toBe("2026-06-01T00:00:00.000Z");
    });

    test("resolveEarliestRunningWaitResumeAt falls back when no running waits", () => {
      const history = new StepHistory({ attempts: [] });
      const fallback = new Date("2026-05-01T00:00:00.000Z");
      expect(
        history.resolveEarliestRunningWaitResumeAt(fallback).toISOString(),
      ).toBe("2026-05-01T00:00:00.000Z");
    });
  });
});

function createMockStepAttempt(
  overrides: Partial<StepAttempt> = {},
): StepAttempt {
  const status = overrides.status ?? "completed";
  return {
    namespaceId: "default",
    id: "step-attempt-id",
    workflowRunId: "workflow-run-id",
    stepName: "step",
    kind: "function",
    status,
    config: {},
    context: null,
    output: null,
    error: null,
    childWorkflowRunNamespaceId: null,
    childWorkflowRunId: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt:
      status === "running" ? null : new Date("2026-01-01T00:00:01.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides,
  };
}
