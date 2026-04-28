import { getBackend } from "./backend";
import { getMetricsResponse } from "./metrics.server";
import type { Backend, WorkflowRunCounts } from "openworkflow/internal";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./backend", () => ({
  getBackend: vi.fn(),
}));

const mockedGetBackend = vi.mocked(getBackend);

const ZERO_COUNTS: WorkflowRunCounts = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  canceled: 0,
};

describe("getMetricsResponse()", () => {
  beforeEach(() => {
    mockedGetBackend.mockReset();
  });

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
    mockedGetBackend.mockResolvedValue(backend);

    const response = await getMetricsResponse();
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
    mockedGetBackend.mockResolvedValue(backend);

    await getMetricsResponse();
    await getMetricsResponse();

    expect(mockedGetBackend).toHaveBeenCalledTimes(2);
    expect(backend.countWorkflowRuns).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when backend aggregation fails", async () => {
    const backend: Pick<Backend, "countWorkflowRuns"> = {
      countWorkflowRuns: vi
        .fn()
        .mockRejectedValue(new Error("failed to aggregate")),
    };
    mockedGetBackend.mockResolvedValue(backend);

    const response = await getMetricsResponse();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
  });
});
