import { getMetricsResponse } from "./metrics.server";
import type { Backend, WorkflowRunCounts } from "openworkflow/internal";
import { describe, expect, it, vi } from "vitest";

const ZERO_COUNTS: WorkflowRunCounts = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  canceled: 0,
};

describe("getMetricsResponse()", () => {
  it("returns Prometheus exposition format with expected metric labels", async () => {
    const counts: WorkflowRunCounts = {
      ...ZERO_COUNTS,
      pending: 3,
      running: 3,
      completed: 4,
      failed: 2,
    };

    const backend: Pick<Backend, "countWorkflowRuns"> = {
      countWorkflowRuns: vi.fn().mockResolvedValue(counts),
    };
    const loadBackend = vi.fn(() => Promise.resolve(backend));

    const response = await getMetricsResponse(loadBackend);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(body).toContain("# HELP openworkflow_workflow_runs");
    expect(body).toContain("# TYPE openworkflow_workflow_runs gauge");
    expect(body).toContain('openworkflow_workflow_runs{status="pending"} 3');
    expect(body).toContain('openworkflow_workflow_runs{status="running"} 3');
    expect(body).not.toContain('openworkflow_workflow_runs{status="sleeping"}');
    expect(body).toContain('openworkflow_workflow_runs{status="completed"} 4');
    expect(body).toContain('openworkflow_workflow_runs{status="failed"} 2');
    expect(body).toContain('openworkflow_workflow_runs{status="canceled"} 0');
  });

  it("calls backend.countWorkflowRuns() on every scrape", async () => {
    const backend: Pick<Backend, "countWorkflowRuns"> = {
      countWorkflowRuns: vi.fn().mockResolvedValue(ZERO_COUNTS),
    };
    const loadBackend = vi.fn(() => Promise.resolve(backend));

    await getMetricsResponse(loadBackend);
    await getMetricsResponse(loadBackend);

    expect(loadBackend).toHaveBeenCalledTimes(2);
    expect(backend.countWorkflowRuns).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when backend aggregation fails", async () => {
    const backend: Pick<Backend, "countWorkflowRuns"> = {
      countWorkflowRuns: vi
        .fn()
        .mockRejectedValue(new Error("failed to aggregate")),
    };
    const loadBackend = vi.fn(() => Promise.resolve(backend));

    const response = await getMetricsResponse(loadBackend);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
  });
});
