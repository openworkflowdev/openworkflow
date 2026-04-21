import { toWorkflowRunCounts } from "./backend.js";
import { describe, expect, test } from "vitest";

describe("toWorkflowRunCounts", () => {
  test("folds legacy succeeded and sleeping rows into normalized counts", () => {
    const counts = toWorkflowRunCounts([
      { status: "completed", count: 2 },
      { status: "succeeded", count: 3 },
      { status: "running", count: 1 },
      { status: "sleeping", count: 4 },
    ]);

    expect(counts).toEqual({
      pending: 0,
      running: 5,
      completed: 5,
      failed: 0,
      canceled: 0,
    });

    const reversedCounts = toWorkflowRunCounts([
      { status: "sleeping", count: 4 },
      { status: "running", count: 1 },
      { status: "succeeded", count: 3 },
      { status: "completed", count: 2 },
    ]);

    expect(reversedCounts).toEqual({
      pending: 0,
      running: 5,
      completed: 5,
      failed: 0,
      canceled: 0,
    });
  });

  test("ignores unknown statuses", () => {
    const counts = toWorkflowRunCounts([
      { status: "pending", count: 1 },
      { status: "unknown_status", count: 99 },
    ]);

    expect(counts).toEqual({
      pending: 1,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
    });
  });
});
