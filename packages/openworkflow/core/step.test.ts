import { ok } from "./result.js";
import {
  serializeError,
  createStepAttemptCacheFromAttempts,
  getCachedStepAttempt,
  hasCompletedStep,
  addToStepAttemptCache,
  normalizeStepOutput,
  calculateSleepResumeAt,
  createSleepContext,
} from "./step.js";
import type { StepAttempt, StepAttemptCache } from "./step.js";
import { describe, expect, test } from "vitest";

describe("serializeError", () => {
  test("serializes Error instance with name, message, and stack", () => {
    const error = new Error("Something went wrong");
    const result = serializeError(error);

    expect(result.name).toBe("Error");
    expect(result.message).toBe("Something went wrong");
    expect(result.stack).toBeDefined();
    expect(typeof result.stack).toBe("string");
  });

  test("serializes TypeError with correct name", () => {
    const error = new TypeError("Invalid type");
    const result = serializeError(error);

    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("Invalid type");
  });

  test("serializes custom Error subclass", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error message");
    const result = serializeError(error);

    expect(result.name).toBe("CustomError");
    expect(result.message).toBe("Custom error message");
  });

  test("serializes Error without stack as null", () => {
    const error = new Error("No stack");
    // @ts-expect-error testing edge case
    error.stack = undefined;
    const result = serializeError(error);

    expect(result.stack).toBeNull();
  });

  test("serializes string to message", () => {
    const result = serializeError("string error");

    expect(result.message).toBe("string error");
    expect(result.name).toBeUndefined();
    expect(result.stack).toBeUndefined();
  });

  test("serializes number to message", () => {
    const result = serializeError(42);

    expect(result.message).toBe("42");
  });

  test("serializes null to message", () => {
    const result = serializeError(null);

    expect(result.message).toBe("null");
  });

  test("serializes undefined to message", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = serializeError(undefined);

    expect(result.message).toBe("undefined");
  });

  test("serializes object to message using String()", () => {
    const result = serializeError({ foo: "bar" });

    expect(result.message).toBe("[object Object]");
  });
});

describe("createStepAttemptCacheFromAttempts", () => {
  test("creates empty cache from empty array", () => {
    const cache = createStepAttemptCacheFromAttempts([]);

    expect(cache.size).toBe(0);
  });

  test("includes completed attempts in cache", () => {
    const attempt = createMockStepAttempt({
      stepName: "step-a",
      status: "completed",
      output: "result",
    });
    const cache = createStepAttemptCacheFromAttempts([attempt]);

    expect(cache.size).toBe(1);
    expect(cache.get("step-a")).toBe(attempt);
  });

  test("includes succeeded attempts in cache (deprecated status)", () => {
    const attempt = createMockStepAttempt({
      stepName: "step-b",
      status: "succeeded",
      output: "result",
    });
    const cache = createStepAttemptCacheFromAttempts([attempt]);

    expect(cache.size).toBe(1);
    expect(cache.get("step-b")).toBe(attempt);
  });

  test("excludes running attempts from cache", () => {
    const attempt = createMockStepAttempt({
      stepName: "step-c",
      status: "running",
    });
    const cache = createStepAttemptCacheFromAttempts([attempt]);

    expect(cache.size).toBe(0);
  });

  test("excludes failed attempts from cache", () => {
    const attempt = createMockStepAttempt({
      stepName: "step-d",
      status: "failed",
      error: { message: "failed" },
    });
    const cache = createStepAttemptCacheFromAttempts([attempt]);

    expect(cache.size).toBe(0);
  });

  test("filters mixed statuses correctly", () => {
    const attempts = [
      createMockStepAttempt({
        stepName: "completed-step",
        status: "completed",
      }),
      createMockStepAttempt({ stepName: "running-step", status: "running" }),
      createMockStepAttempt({ stepName: "failed-step", status: "failed" }),
      createMockStepAttempt({
        stepName: "succeeded-step",
        status: "succeeded",
      }),
    ];
    const cache = createStepAttemptCacheFromAttempts(attempts);

    expect(cache.size).toBe(2);
    expect(cache.has("completed-step")).toBe(true);
    expect(cache.has("succeeded-step")).toBe(true);
    expect(cache.has("running-step")).toBe(false);
    expect(cache.has("failed-step")).toBe(false);
  });

  test("uses step name as cache key", () => {
    const attempt = createMockStepAttempt({
      stepName: "my-unique-step-name",
      status: "completed",
    });
    const cache = createStepAttemptCacheFromAttempts([attempt]);

    expect(cache.get("my-unique-step-name")).toBe(attempt);
    expect(cache.get("other-name")).toBeUndefined();
  });
});

describe("getCachedStepAttempt", () => {
  test("returns cached attempt when present", () => {
    const attempt = createMockStepAttempt({ stepName: "cached-step" });
    const cache: StepAttemptCache = new Map([["cached-step", attempt]]);

    const result = getCachedStepAttempt(cache, "cached-step");

    expect(result).toBe(attempt);
  });

  test("returns undefined when step not in cache", () => {
    const cache: StepAttemptCache = new Map();

    const result = getCachedStepAttempt(cache, "missing-step");

    expect(result).toBeUndefined();
  });

  test("returns undefined for similar but different step names", () => {
    const attempt = createMockStepAttempt({ stepName: "step-1" });
    const cache: StepAttemptCache = new Map([["step-1", attempt]]);

    expect(getCachedStepAttempt(cache, "step-2")).toBeUndefined();
    expect(getCachedStepAttempt(cache, "Step-1")).toBeUndefined();
    expect(getCachedStepAttempt(cache, "step-1 ")).toBeUndefined();
  });
});

describe("hasCompletedStep", () => {
  test("returns true when step is in cache", () => {
    const attempt = createMockStepAttempt({ stepName: "step-x" });
    const cache: StepAttemptCache = new Map([["step-x", attempt]]);

    expect(hasCompletedStep(cache, "step-x")).toBe(true);
  });

  test("returns false when step is not in cache", () => {
    const cache: StepAttemptCache = new Map();

    expect(hasCompletedStep(cache, "step-y")).toBe(false);
  });

  test("returns false for empty cache", () => {
    const cache: StepAttemptCache = new Map();

    expect(hasCompletedStep(cache, "any-step")).toBe(false);
  });
});

describe("addToStepAttemptCache", () => {
  test("adds attempt to empty cache", () => {
    const cache: StepAttemptCache = new Map();
    const attempt = createMockStepAttempt({ stepName: "new-step" });

    const newCache = addToStepAttemptCache(cache, attempt);

    expect(newCache.size).toBe(1);
    expect(newCache.get("new-step")).toBe(attempt);
  });

  test("adds attempt to existing cache", () => {
    const existing = createMockStepAttempt({ stepName: "existing-step" });
    const cache: StepAttemptCache = new Map([["existing-step", existing]]);
    const newAttempt = createMockStepAttempt({ stepName: "new-step" });

    const newCache = addToStepAttemptCache(cache, newAttempt);

    expect(newCache.size).toBe(2);
    expect(newCache.get("existing-step")).toBe(existing);
    expect(newCache.get("new-step")).toBe(newAttempt);
  });

  test("does not mutate original cache (immutable)", () => {
    const existing = createMockStepAttempt({ stepName: "existing-step" });
    const cache: StepAttemptCache = new Map([["existing-step", existing]]);
    const newAttempt = createMockStepAttempt({ stepName: "new-step" });

    const newCache = addToStepAttemptCache(cache, newAttempt);

    expect(cache.size).toBe(1);
    expect(cache.has("new-step")).toBe(false);
    expect(newCache.size).toBe(2);
  });

  test("overwrites existing entry with same step name", () => {
    const original = createMockStepAttempt({
      stepName: "step",
      output: "original",
    });
    const cache: StepAttemptCache = new Map([["step", original]]);
    const replacement = createMockStepAttempt({
      stepName: "step",
      output: "replacement",
    });

    const newCache = addToStepAttemptCache(cache, replacement);

    expect(newCache.size).toBe(1);
    expect(newCache.get("step")?.output).toBe("replacement");
  });
});

describe("normalizeStepOutput", () => {
  test("passes through string values", () => {
    expect(normalizeStepOutput("hello")).toBe("hello");
  });

  test("passes through number values", () => {
    expect(normalizeStepOutput(42)).toBe(42);
    expect(normalizeStepOutput(3.14)).toBe(3.14);
    expect(normalizeStepOutput(0)).toBe(0);
    expect(normalizeStepOutput(-1)).toBe(-1);
  });

  test("passes through boolean values", () => {
    expect(normalizeStepOutput(true)).toBe(true);
    expect(normalizeStepOutput(false)).toBe(false);
  });

  test("passes through null", () => {
    expect(normalizeStepOutput(null)).toBeNull();
  });

  test("converts undefined to null", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(normalizeStepOutput(undefined)).toBeNull();
  });

  test("passes through object values", () => {
    const obj = { foo: "bar", nested: { baz: 123 } };
    expect(normalizeStepOutput(obj)).toBe(obj);
  });

  test("passes through array values", () => {
    const arr = [1, 2, 3];
    expect(normalizeStepOutput(arr)).toBe(arr);
  });

  test("passes through empty object", () => {
    const obj = {};
    expect(normalizeStepOutput(obj)).toBe(obj);
  });

  test("passes through empty array", () => {
    const arr: unknown[] = [];
    expect(normalizeStepOutput(arr)).toBe(arr);
  });
});

describe("calculateSleepResumeAt", () => {
  test("calculates resume time from duration string", () => {
    const now = 1_000_000;
    const result = calculateSleepResumeAt("5s", now);

    expect(result).toEqual(ok(new Date(now + 5000)));
  });

  test("calculates resume time with milliseconds", () => {
    const now = 1_000_000;
    const result = calculateSleepResumeAt("500ms", now);

    expect(result).toEqual(ok(new Date(now + 500)));
  });

  test("calculates resume time with minutes", () => {
    const now = 1_000_000;
    const result = calculateSleepResumeAt("2m", now);

    expect(result).toEqual(ok(new Date(now + 2 * 60 * 1000)));
  });

  test("calculates resume time with hours", () => {
    const now = 1_000_000;
    const result = calculateSleepResumeAt("1h", now);

    expect(result).toEqual(ok(new Date(now + 60 * 60 * 1000)));
  });

  test("uses Date.now() when now is not provided", () => {
    const before = Date.now();
    const result = calculateSleepResumeAt("1s");
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resumeTime = result.value.getTime();
      expect(resumeTime).toBeGreaterThanOrEqual(before + 1000);
      expect(resumeTime).toBeLessThanOrEqual(after + 1000);
    }
  });

  test("returns error for invalid duration", () => {
    // @ts-expect-error testing invalid input
    const result = calculateSleepResumeAt("invalid");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  test("returns error for empty duration", () => {
    // @ts-expect-error testing invalid input
    const result = calculateSleepResumeAt("");

    expect(result.ok).toBe(false);
  });
});

describe("createSleepContext", () => {
  test("creates sleep context with ISO string timestamp", () => {
    const resumeAt = new Date("2025-06-15T10:30:00.000Z");
    const context = createSleepContext(resumeAt);

    expect(context).toEqual({
      kind: "sleep",
      resumeAt: "2025-06-15T10:30:00.000Z",
    });
  });

  test("preserves millisecond precision", () => {
    const resumeAt = new Date("2025-01-01T00:00:00.123Z");
    const context = createSleepContext(resumeAt);

    expect(context.resumeAt).toBe("2025-01-01T00:00:00.123Z");
  });

  test("always has kind set to sleep", () => {
    const resumeAt = new Date();
    const context = createSleepContext(resumeAt);

    expect(context.kind).toBe("sleep");
  });

  test("creates context from current date", () => {
    const now = new Date();
    const context = createSleepContext(now);

    expect(context.resumeAt).toBe(now.toISOString());
  });
});

function createMockStepAttempt(
  overrides: Partial<StepAttempt> = {},
): StepAttempt {
  return {
    namespaceId: "default",
    id: "step-1",
    workflowRunId: "workflow-1",
    stepName: "test-step",
    kind: "function",
    status: "completed",
    config: {},
    context: null,
    output: null,
    error: null,
    childWorkflowRunNamespaceId: null,
    childWorkflowRunId: null,
    startedAt: new Date("2025-01-01T00:00:00Z"),
    finishedAt: new Date("2025-01-01T00:00:01Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:01Z"),
    ...overrides,
  };
}
